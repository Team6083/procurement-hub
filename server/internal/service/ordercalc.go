package service

import (
	"context"
	"errors"
	"sort"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// recomputeOpts tunes recomputeOrder.
type recomputeOpts struct {
	// skipItems leaves the linked items' computed fields alone (used while
	// review confirmation is being undone).
	skipItems bool
	// alsoItems are items whose lines were just removed and need a refresh.
	alsoItems []bson.ObjectID
}

func eqDec(a, b *domain.Decimal) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(b.Decimal)
}

func decPtr(d *decimal.Decimal) *domain.Decimal {
	if d == nil {
		return nil
	}
	return &domain.Decimal{Decimal: *d}
}

func sortedIDs(set map[bson.ObjectID]bool) []bson.ObjectID {
	out := make([]bson.ObjectID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hex() < out[j].Hex() })
	return out
}

// recomputeOrder is the single write path of an order: given the order as the
// caller changed it in memory (and the line/cost entry documents already
// written), it recomputes line quantities and statuses (§10.3), resets the
// allocation of draft cost entries whose teams or lines are gone, runs the §11
// calculation, persists the order with a version bump, then refreshes the
// linked items and re-derives their batches. It must run inside the caller's
// transaction. The second result lists the cost entries reset to "all".
func (s *Batches) recomputeOrder(ctx context.Context, o *domain.VendorOrder, opts recomputeOpts) (*domain.VendorOrder, []bson.ObjectID, error) {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, nil, err
	}
	ids := make([]bson.ObjectID, len(lines))
	for i, l := range lines {
		ids[i] = l.ID
	}
	matches, err := s.st.ActiveMatchesByLines(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	problems, err := s.st.ActiveProblemsByLines(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	entries, err := s.st.CostEntriesByOrder(ctx, o.ID)
	if err != nil {
		return nil, nil, err
	}

	teams, batches, items := map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}
	for _, l := range lines {
		teams[l.TeamID] = true
		if l.BatchID != nil {
			batches[*l.BatchID] = true
		}
		if l.ItemID != nil {
			items[*l.ItemID] = true
		}
	}
	for _, id := range opts.alsoItems {
		items[id] = true
	}
	o.TeamIDs, o.BatchIDs = sortedIDs(teams), sortedIDs(batches)
	// In a draft, lines come and go: an entry whose teams or lines are gone goes back to "all".
	var reset []bson.ObjectID
	if o.Status == domain.OrderDraft {
		al := make([]domain.AllocLine, len(lines))
		for i, l := range lines {
			al[i] = domain.AllocLine{ID: l.ID, TeamID: l.TeamID}
		}
		for i := range entries {
			e := &entries[i]
			if e.Voided != nil || e.Allocation.Mode == domain.AllocAll || domain.CheckAllocationScope(e.Allocation, al) == nil {
				continue
			}
			if err := s.st.UpdateCostEntry(ctx, e.ID, bson.D{{Key: "allocation", Value: domain.Allocation{Mode: domain.AllocAll}}}); err != nil {
				return nil, nil, err
			}
			e.Allocation = domain.Allocation{Mode: domain.AllocAll}
			reset = append(reset, e.ID)
		}
	}

	// Line quantities and statuses.
	for i := range lines {
		l := &lines[i]
		var ms []domain.DeliveryMatch
		for _, m := range matches {
			if m.VendorOrderLineID == l.ID {
				ms = append(ms, m)
			}
		}
		var ps []domain.LineProblem
		for _, p := range problems {
			if p.VendorOrderLineID == l.ID {
				ps = append(ps, p)
			}
		}
		q := domain.ComputeQuantities(ms, ps)
		l.ReturnedQty, l.ReceivedQty, l.OpenProblemQty = q.Returned, q.Received, q.OpenProblem
		l.ExpectedQty = l.Quantity - q.Returned
	}

	// Money (spec §11). A cancelled order keeps lineC and the order-currency totals; every base-currency value is cleared below.
	var cost domain.OrderCost
	var costEntries []int // indexes into entries of the entries the calculation saw (not voided)
	{
		in := domain.OrderCostInput{
			Currency: o.Currency, Base: s.cur.Base, BaseDigits: s.cur.Digits(s.cur.Base), Rates: map[string]decimal.Decimal{},
		}
		if o.ChargedAmountBase != nil {
			c := o.ChargedAmountBase.Decimal
			in.ChargedBase = &c
		}
		rateOf := func(cur string) error {
			if _, done := in.Rates[cur]; done || cur == s.cur.Base {
				return nil
			}
			r, err := s.st.GetRate(ctx, cur)
			if errors.Is(err, store.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			in.Rates[cur] = r.RateToBase.Decimal
			return nil
		}
		if err := rateOf(o.Currency); err != nil {
			return nil, nil, err
		}
		for _, l := range lines {
			cl := domain.CostLine{LineNo: l.LineNo, LineID: l.ID.Hex(), TeamID: l.TeamID.Hex(), Quantity: l.Quantity}
			if l.UnitPrice != nil {
				p := l.UnitPrice.Decimal
				cl.UnitPrice = &p
			}
			in.Lines = append(in.Lines, cl)
		}
		for k, e := range entries {
			if e.Voided != nil {
				continue
			}
			costEntries = append(costEntries, k)
			ci := domain.CostEntryInput{Settlement: e.Settlement, Currency: e.Currency, Amount: e.Amount.Decimal, Mode: e.Allocation.Mode}
			if e.ActualAmountBase != nil {
				a := e.ActualAmountBase.Decimal
				ci.ActualBase = &a
			}
			for _, t := range e.Allocation.TeamIDs {
				ci.TeamIDs = append(ci.TeamIDs, t.Hex())
			}
			for _, id := range e.Allocation.LineIDs {
				ci.LineIDs = append(ci.LineIDs, id.Hex())
			}
			for _, m := range e.Allocation.Amounts {
				ci.Manual = append(ci.Manual, domain.ManualShare{LineID: m.LineID.Hex(), Amount: m.Amount.Decimal})
			}
			if e.Settlement == domain.SettleSeparate && e.ActualAmountBase == nil {
				if err := rateOf(e.Currency); err != nil {
					return nil, nil, err
				}
			}
			in.Entries = append(in.Entries, ci)
		}
		cost = domain.CalcOrderCost(in)
	}
	if o.Status == domain.OrderCancelled {
		cost = cancelledCost(cost)
	}
	// Computed fields of the cost entries (not a user edit: no version bump).
	computed := make([]domain.EntryCost, len(entries))
	for i, k := range costEntries {
		computed[k] = cost.Entries[i]
	}
	for i := range entries {
		e := &entries[i]
		am := decPtr(computed[i].AmountBase)
		if eqDec(e.AmountBase, am) && e.Provisional == computed[i].Provisional {
			continue
		}
		if err := s.st.SetCostEntryComputed(ctx, e.ID, am, computed[i].Provisional); err != nil {
			return nil, nil, err
		}
		e.AmountBase, e.Provisional = am, computed[i].Provisional
	}

	// Persist changed lines; collect derived-status events.
	var evs []domain.AuditEvent
	for i := range lines {
		l := &lines[i]
		l.Status = domain.DeriveLineStatus(domain.LineStatusInput{
			Order: o.Status, Closure: l.Closure, Quantity: l.Quantity, ReturnedQty: l.ReturnedQty,
			ReceivedQty: l.ReceivedQty, OpenProblem: l.OpenProblemQty,
		})
		var c domain.LineCost
		if i < len(cost.Lines) {
			c = cost.Lines[i]
		}
		cc := decPtr(c.LineC)
		cb, sb, gb, tb := decPtr(c.CostBase), decPtr(c.SharedBase), decPtr(c.SeparateBase), decPtr(c.TotalBase)
		stored, err := s.st.GetLine(ctx, l.ID)
		if err != nil {
			return nil, nil, mapStore(err)
		}
		if stored.Status == l.Status && stored.ReturnedQty == l.ReturnedQty && stored.ExpectedQty == l.ExpectedQty &&
			stored.ReceivedQty == l.ReceivedQty && stored.OpenProblemQty == l.OpenProblemQty &&
			eqDec(stored.LineC, cc) && eqDec(stored.CostBase, cb) && eqDec(stored.SharedBase, sb) && eqDec(stored.SeparateBase, gb) && eqDec(stored.TotalBase, tb) &&
			stored.CostProvisional == c.CostProvisional && stored.SeparateProvisional == c.SeparateProvisional {
			continue
		}
		if err := s.st.UpdateLine(ctx, l.ID, bson.D{
			{Key: "status", Value: l.Status}, {Key: "returnedQuantity", Value: l.ReturnedQty}, {Key: "expectedQuantity", Value: l.ExpectedQty},
			{Key: "receivedQuantity", Value: l.ReceivedQty}, {Key: "openProblemQuantity", Value: l.OpenProblemQty},
			{Key: "lineC", Value: cc}, {Key: "costBase", Value: cb}, {Key: "sharedBase", Value: sb}, {Key: "separateBase", Value: gb}, {Key: "totalBase", Value: tb},
			{Key: "costProvisional", Value: c.CostProvisional}, {Key: "separateProvisional", Value: c.SeparateProvisional},
		}); err != nil {
			return nil, nil, err
		}
		inPlay := func(st domain.LineStatus) bool {
			return st != domain.LineDraft && st != domain.LineCancelled && st != ""
		}
		if stored.Status != l.Status && inPlay(stored.Status) && inPlay(l.Status) {
			evs = append(evs, domain.AuditEvent{
				Actor: audit.SystemActor("derive"), TeamIDs: []bson.ObjectID{l.TeamID}, BatchID: derefID(l.BatchID),
				ObjectType: "vendor_order", ObjectID: o.ID.Hex(), Scope: "line", LineIDs: []string{l.ID.Hex()},
				Action:  "vendor_order.line_status_derived",
				Changes: []domain.AuditChange{{Field: "status", From: string(stored.Status), To: string(l.Status)}},
			})
		}
		// Manual closures emit line.closed with the user as actor (CloseLine).
		if l.Closure == nil && stored.Status != l.Status && (l.Status == domain.LineReceived || l.Status == domain.LineNotObtained) {
			if err := s.st.Emit(ctx, store.EventRecord{Type: "line.closed", Actor: audit.SystemActor("derive"), TeamID: l.TeamID,
				BatchID: derefID(l.BatchID), ObjectID: o.ID.Hex()}); err != nil {
				return nil, nil, err
			}
		}
	}

	// Order totals.
	t := domain.OrderTotals{Provisional: cost.Provisional, FactorProvisional: cost.FactorProvisional, Incomplete: cost.Incomplete}
	if t.Incomplete == nil {
		t.Incomplete = []domain.Incomplete{}
	}
	t.LinesC, t.CheckoutC, t.OriginalC, t.Factor = decPtr(cost.LinesC), decPtr(cost.CheckoutC), decPtr(cost.OriginalC), decPtr(cost.F)
	t.TargetBase, t.SeparateBase, t.NetBase = decPtr(cost.TargetBase), decPtr(cost.SeparateBase), decPtr(cost.NetBase)
	sts := make([]domain.LineStatus, len(lines))
	for i := range lines {
		sts[i] = lines[i].Status
	}
	pr := domain.DeriveOrderProgress(o.Status, sts, t)
	o.ReceivingState, o.AccountingState, o.Completed = pr.Receiving, pr.Accounting, pr.Completed
	set := bson.D{
		{Key: "receivingState", Value: pr.Receiving}, {Key: "accountingState", Value: pr.Accounting}, {Key: "completed", Value: pr.Completed},
		{Key: "vendorId", Value: o.VendorID}, {Key: "currency", Value: o.Currency}, {Key: "status", Value: o.Status},
		{Key: "ownerIds", Value: o.OwnerIDs},
		{Key: "externalOrderNo", Value: o.ExternalOrderNo}, {Key: "placedAt", Value: o.PlacedAt}, {Key: "placedBy", Value: o.PlacedBy},
		{Key: "chargedAmountBase", Value: o.ChargedAmountBase},
		{Key: "expectedDeliveryDate", Value: o.ExpectedDelivery}, {Key: "paymentNote", Value: o.PaymentNote},
		{Key: "cancellation", Value: o.Cancellation}, {Key: "lineCounter", Value: o.LineCounter},
		{Key: "teamIds", Value: o.TeamIDs}, {Key: "batchIds", Value: o.BatchIDs}, {Key: "totals", Value: t},
	}
	out, err := s.st.UpdateVendorOrder(ctx, o.ID, o.Version, set)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	if err := s.audit.Record(ctx, evs...); err != nil {
		return nil, nil, err
	}
	if opts.skipItems {
		return out, reset, nil
	}
	return out, reset, s.refreshLinked(ctx, sortedIDs(items))
}

// cancelledCost keeps what a cancelled order still shows: every line's lineC and the order-currency totals.
// Every base-currency value, the flags and the incomplete reasons are dropped.
func cancelledCost(c domain.OrderCost) domain.OrderCost {
	out := domain.OrderCost{Lines: make([]domain.LineCost, len(c.Lines)), Entries: make([]domain.EntryCost, len(c.Entries)),
		LinesC: c.LinesC, CheckoutC: c.CheckoutC, OriginalC: c.OriginalC}
	for i, l := range c.Lines {
		out.Lines[i] = domain.LineCost{LineNo: l.LineNo, LineC: l.LineC}
	}
	return out
}

func derefID(id *bson.ObjectID) bson.ObjectID {
	if id == nil {
		return bson.ObjectID{}
	}
	return *id
}

// refreshLinked recomputes the computed purchasing fields of items and
// re-derives their batches' status (spec §10.1, §10.2). Each batch is bumped so
// the write conflicts with review-confirmation changes (spec §10 intro).
func (s *Batches) refreshLinked(ctx context.Context, itemIDs []bson.ObjectID) error {
	batchSeen := map[bson.ObjectID]bool{}
	var order []bson.ObjectID
	for _, id := range itemIDs {
		it, err := s.st.GetItem(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		b, err := s.st.GetBatch(ctx, it.BatchID)
		if err != nil {
			return mapStore(err)
		}
		if err := s.refreshItem(ctx, b, it); err != nil {
			return err
		}
		if !batchSeen[b.ID] {
			batchSeen[b.ID] = true
			order = append(order, b.ID)
		}
	}
	for _, id := range order {
		if err := s.st.BumpBatch(ctx, id); err != nil {
			return mapStore(err)
		}
		if err := s.DeriveStatus(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
