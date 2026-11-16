package service

import (
	"context"
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
// caller changed it in memory (and the line/ledger documents already written),
// it recomputes line quantities and statuses (§10.3), clears stale team
// overrides, runs the §11 calculation, persists the order with a version bump,
// then refreshes the linked items and re-derives their batches. It must run
// inside the caller's transaction. The second result reports whether team
// cost overrides were cleared.
func (s *Batches) recomputeOrder(ctx context.Context, o *domain.VendorOrder, opts recomputeOpts) (*domain.VendorOrder, bool, error) {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, false, err
	}
	ids := make([]bson.ObjectID, len(lines))
	for i, l := range lines {
		ids[i] = l.ID
	}
	matches, err := s.st.ActiveMatchesByLines(ctx, ids)
	if err != nil {
		return nil, false, err
	}
	problems, err := s.st.ActiveProblemsByLines(ctx, ids)
	if err != nil {
		return nil, false, err
	}
	ledger, err := s.st.LedgerByOrder(ctx, o.ID)
	if err != nil {
		return nil, false, err
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
	cleared := false
	if o.Status == domain.OrderDraft && o.TeamCostOverrides != nil && !domain.SameTeams(o.TeamCostOverrides, o.TeamIDs) {
		o.TeamCostOverrides, o.OverrideReason, cleared = nil, "", true
	}
	if o.SharedCosts == nil {
		o.SharedCosts = []domain.SharedCost{}
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

	// Money (spec §11). Cancelled orders have no amounts.
	cost := domain.OrderCost{}
	lineNoOf := map[bson.ObjectID]int{}
	for _, l := range lines {
		lineNoOf[l.ID] = l.LineNo
	}
	ledgerSum := decimal.Zero
	if o.Status != domain.OrderCancelled {
		in := domain.OrderCostInput{
			Currency: o.Currency, Base: s.cur.Base, BaseDigits: s.cur.Digits(s.cur.Base),
		}
		if o.ChargedAmountBase != nil {
			c := o.ChargedAmountBase.Decimal
			in.ChargedBase = &c
		}
		if o.Currency != s.cur.Base {
			if r, err := s.st.GetRate(ctx, o.Currency); err == nil {
				d := r.RateToBase.Decimal
				in.Rate = &d
			} else if err != store.ErrNotFound {
				return nil, false, err
			}
		}
		for _, l := range lines {
			cl := domain.CostLine{LineNo: l.LineNo, TeamID: l.TeamID.Hex(), Quantity: l.Quantity}
			if l.UnitPrice != nil {
				p := l.UnitPrice.Decimal
				cl.UnitPrice = &p
			}
			in.Lines = append(in.Lines, cl)
		}
		for _, sc := range o.SharedCosts {
			in.SharedCosts = append(in.SharedCosts, sc.Amount.Decimal)
		}
		for _, to := range o.TeamCostOverrides {
			in.TeamOverrides = append(in.TeamOverrides, domain.TeamOverride{TeamID: to.TeamID.Hex(), Amount: to.Amount.Decimal})
		}
		for _, e := range ledger {
			if e.Voided != nil {
				continue
			}
			ledgerSum = ledgerSum.Add(e.AmountBase.Decimal)
			la := domain.LedgerAmount{AmountBase: e.AmountBase.Decimal}
			if e.LineID != nil {
				la.LineNo = lineNoOf[*e.LineID]
			}
			in.Ledger = append(in.Ledger, la)
		}
		cost = domain.CalcOrderCost(in)
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
		cb, sb, lb, tb := decPtr(c.CostBase), decPtr(c.SharedBase), decPtr(c.LedgerBase), decPtr(c.TotalBase)
		stored, err := s.st.GetLine(ctx, l.ID)
		if err != nil {
			return nil, false, mapStore(err)
		}
		if stored.Status == l.Status && stored.ReturnedQty == l.ReturnedQty && stored.ExpectedQty == l.ExpectedQty &&
			stored.ReceivedQty == l.ReceivedQty && stored.OpenProblemQty == l.OpenProblemQty &&
			eqDec(stored.CostBase, cb) && eqDec(stored.SharedBase, sb) && eqDec(stored.LedgerBase, lb) && eqDec(stored.TotalBase, tb) {
			continue
		}
		if err := s.st.UpdateLine(ctx, l.ID, bson.D{
			{Key: "status", Value: l.Status}, {Key: "returnedQuantity", Value: l.ReturnedQty}, {Key: "expectedQuantity", Value: l.ExpectedQty},
			{Key: "receivedQuantity", Value: l.ReceivedQty}, {Key: "openProblemQuantity", Value: l.OpenProblemQty},
			{Key: "costBase", Value: cb}, {Key: "sharedBase", Value: sb}, {Key: "ledgerBase", Value: lb}, {Key: "totalBase", Value: tb},
		}); err != nil {
			return nil, false, err
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
				return nil, false, err
			}
		}
	}

	// Order totals.
	t := domain.OrderTotals{Provisional: cost.Provisional, Incomplete: cost.Incomplete}
	if t.Incomplete == nil {
		t.Incomplete = []domain.Incomplete{}
	}
	if o.Status != domain.OrderCancelled {
		sc := domain.Decimal{Decimal: cost.SharedC}
		t.SharedC = &sc
		t.OriginalC, t.Factor, t.TargetBase, t.NetBase = decPtr(cost.OriginalC), decPtr(cost.F), decPtr(cost.TargetBase), decPtr(cost.NetBase)
		if cost.OriginalC != nil {
			sum := decimal.Zero
			for _, lc := range cost.Lines {
				sum = sum.Add(*lc.LineC)
			}
			t.LinesC = &domain.Decimal{Decimal: sum}
		}
		if cost.NetBase != nil {
			t.LedgerBase = &domain.Decimal{Decimal: ledgerSum}
		}
	}
	set := bson.D{
		{Key: "vendorId", Value: o.VendorID}, {Key: "currency", Value: o.Currency}, {Key: "status", Value: o.Status},
		{Key: "externalOrderNo", Value: o.ExternalOrderNo}, {Key: "placedAt", Value: o.PlacedAt}, {Key: "placedBy", Value: o.PlacedBy},
		{Key: "sharedCosts", Value: o.SharedCosts}, {Key: "teamCostOverrides", Value: o.TeamCostOverrides},
		{Key: "overrideReason", Value: o.OverrideReason}, {Key: "chargedAmountBase", Value: o.ChargedAmountBase},
		{Key: "expectedDeliveryDate", Value: o.ExpectedDelivery}, {Key: "paymentNote", Value: o.PaymentNote},
		{Key: "cancellation", Value: o.Cancellation}, {Key: "lineCounter", Value: o.LineCounter},
		{Key: "teamIds", Value: o.TeamIDs}, {Key: "batchIds", Value: o.BatchIDs}, {Key: "totals", Value: t},
	}
	out, err := s.st.UpdateVendorOrder(ctx, o.ID, o.Version, set)
	if err != nil {
		return nil, false, mapStore(err)
	}
	if err := s.audit.Record(ctx, evs...); err != nil {
		return nil, false, err
	}
	if opts.skipItems {
		return out, cleared, nil
	}
	return out, cleared, s.refreshLinked(ctx, sortedIDs(items))
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
