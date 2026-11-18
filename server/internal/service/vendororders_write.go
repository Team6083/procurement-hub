package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// orderMutation is what a write function reports back to mutate.
type orderMutation struct {
	events []domain.AuditEvent
	emit   []store.EventRecord
	also   []bson.ObjectID // items whose lines were removed
}

// mutate runs one write on an order in a transaction: it loads the order,
// checks the client's If-Match against the order version, lets fn change the
// order (in memory) and its lines or cost entries, then recomputes and persists
// everything with a single version bump (spec §10 intro). Internal write
// conflicts are retried by the driver; only a stale If-Match fails.
func (s *VendorOrders) mutate(ctx context.Context, actor authz.Actor, id bson.ObjectID, ifMatch *int64,
	fn func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error)) (*OrderDetail, error) {
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	var detail *OrderDetail
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		o, err := s.st.GetVendorOrder(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		if ifMatch != nil && o.Version != *ifMatch {
			return ErrVersionConflict
		}
		m, err := fn(ctx, o)
		if err != nil {
			return err
		}
		out, reset, err := s.batches.recomputeOrder(ctx, o, recomputeOpts{alsoItems: m.also})
		if err != nil {
			return err
		}
		for i := range m.events {
			if m.events[i].Scope == "order" || m.events[i].Scope == "" {
				m.events[i].Scope = "order"
				m.events[i].TeamIDs = out.TeamIDs
			}
			if len(reset) > 0 && i == 0 {
				m.events[i].Changes = append(m.events[i].Changes, domain.AuditChange{Field: "costEntries.allocation", From: idHexes(reset), To: "all (teams or lines changed)"})
			}
		}
		if err := s.audit.Record(ctx, m.events...); err != nil {
			return err
		}
		for _, e := range m.emit {
			if err := s.st.Emit(ctx, e); err != nil {
				return err
			}
		}
		if detail, err = s.detail(ctx, actor, out); err != nil {
			return err
		}
		detail.AllocationsReset = len(reset) > 0
		return nil
	})
	return detail, err
}

func (s *VendorOrders) event(actor authz.Actor, o *domain.VendorOrder, action, comment string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "vendor_order", ObjectID: o.ID.Hex(), Scope: "order",
		Action: action, Comment: comment, Changes: changes}
}

func (s *VendorOrders) lineEvent(actor authz.Actor, o *domain.VendorOrder, l *domain.VendorOrderLine, action, comment string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{Actor: actor.UserID.Hex(), TeamIDs: []bson.ObjectID{l.TeamID}, BatchID: derefID(l.BatchID),
		ObjectType: "vendor_order", ObjectID: o.ID.Hex(), Scope: "line", LineIDs: []string{l.ID.Hex()},
		Action: action, Comment: comment, Changes: changes}
}

func reasonOf(s string) (string, error) {
	r := strings.TrimSpace(s)
	if r == "" {
		return "", Invalid("reason", "required")
	}
	return r, nil
}

func ch(field string, from, to any) domain.AuditChange {
	return domain.AuditChange{Field: field, From: from, To: to}
}

func decStr(d *domain.Decimal) any {
	if d == nil {
		return nil
	}
	return d.String()
}

// ---- create ----

type CreateOrderInput struct {
	VendorID bson.ObjectID
	Currency string // empty: the vendor's default
	ItemIDs  []bson.ObjectID
	OwnerIDs []bson.ObjectID // nil: the creator
}

// checkOwners validates owner ids (purchasers by roleSnapshot, unless already
// owners), dropping duplicates.
func (s *VendorOrders) checkOwners(ctx context.Context, ids, current []bson.ObjectID) ([]bson.ObjectID, error) {
	out := make([]bson.ObjectID, 0, len(ids))
	for _, id := range ids {
		if slices.Contains(out, id) {
			continue
		}
		if slices.Contains(current, id) {
			out = append(out, id) // already an owner: stays even after losing the role
			continue
		}
		u, err := s.st.GetUser(ctx, id)
		if err != nil || !u.RoleSnapshot.Purchaser {
			return nil, Invalid("ownerIds", id.Hex()+" is not a purchaser")
		}
		out = append(out, id)
	}
	return out, nil
}

// emitOwnersAdded sends assignment.added to owners that are new on the order.
func (s *VendorOrders) ownersAdded(actor authz.Actor, o *domain.VendorOrder, old, now []bson.ObjectID) []store.EventRecord {
	var out []store.EventRecord
	for _, id := range now {
		if !slices.Contains(old, id) {
			out = append(out, store.EventRecord{Type: "assignment.added", Actor: actor.UserID.Hex(), ObjectID: o.ID.Hex(), Recipient: id.Hex()})
		}
	}
	return out
}

// Create makes a draft order, optionally with one line per item.
func (s *VendorOrders) Create(ctx context.Context, actor authz.Actor, in CreateOrderInput) (*OrderDetail, error) {
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	v, err := s.st.GetVendor(ctx, in.VendorID)
	if err != nil || !v.Active {
		return nil, Invalid("vendorId", "unknown or inactive vendor")
	}
	cur := strings.ToUpper(strings.TrimSpace(in.Currency))
	if cur == "" {
		cur = v.DefaultCurrency
	}
	if !contains(s.supported, cur) {
		return nil, Invalid("currency", cur+" is not a supported currency")
	}
	owners := []bson.ObjectID{actor.UserID}
	if in.OwnerIDs != nil {
		if owners, err = s.checkOwners(ctx, in.OwnerIDs, nil); err != nil {
			return nil, err
		}
	}
	var id bson.ObjectID
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		n, err := s.st.NextCounter(ctx, "vendorOrder")
		if err != nil {
			return mapStore(err)
		}
		o := &domain.VendorOrder{Number: n, VendorID: v.ID, Currency: cur, Status: domain.OrderDraft, OwnerIDs: owners, CreatedBy: actor.UserID}
		if err := s.st.InsertVendorOrder(ctx, o); err != nil {
			return mapStore(err)
		}
		id = o.ID
		evs := []domain.AuditEvent{s.event(actor, o, "vendor_order.created", "", ch("vendor", "", v.Name), ch("currency", "", cur))}
		for _, itemID := range in.ItemIDs {
			_, ev, err := s.addItemLine(ctx, actor, o, itemID, lineFields{})
			if err != nil {
				return err
			}
			evs = append(evs, ev)
		}
		out, _, err := s.batches.recomputeOrder(ctx, o, recomputeOpts{})
		if err != nil {
			return err
		}
		for i := range evs {
			if evs[i].Scope == "order" {
				evs[i].TeamIDs = out.TeamIDs
			}
		}
		if err := s.audit.Record(ctx, evs...); err != nil {
			return err
		}
		for _, e := range s.ownersAdded(actor, o, nil, owners) {
			if e.Recipient == actor.UserID.Hex() {
				continue // the creator knows
			}
			if err := s.st.Emit(ctx, e); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, actor, id)
}

// lineFields are the user-editable line fields; nil pointers mean "default".
type lineFields struct {
	TeamID    *bson.ObjectID
	Name      *string
	SKU       *string
	Quantity  *int
	UnitPrice *domain.Decimal
	PriceSet  bool // UnitPrice is explicit (even when nil = no price)
}

func (s *VendorOrders) checkPrice(o *domain.VendorOrder, p *domain.Decimal) error {
	if p == nil {
		return nil
	}
	if p.IsNegative() {
		return Invalid("unitPrice", "must not be negative")
	}
	if n := s.batches.cur.Digits(o.Currency); !domain.FitsDigits(p.Decimal, n) {
		return Invalid("unitPrice", "at most "+itoa(n)+" fractional digits for "+o.Currency)
	}
	return nil
}

func validLineName(name string) error {
	n := strings.TrimSpace(name)
	if n == "" || utf8.RuneCountInString(n) > 300 {
		return Invalid("name", "required, at most 300 characters")
	}
	return nil
}

// itemGate checks the conditions for linking an item to a line (spec §10.3).
func itemLinkable(it *domain.Item, b *domain.Batch) error {
	if it.Status != domain.ItemApproved || b.ReviewConfirmation == nil || b.ReviewConfirmation.PurchaseOutside {
		return Rule("item_not_purchasable", "Item %q is not an approved item of a review-confirmed batch.", it.Name)
	}
	if it.Unpurchasable != nil {
		return Rule("item_not_purchasable", "Item %q is marked unpurchasable.", it.Name)
	}
	return nil
}

// addItemLine adds a line linked to an item to a draft order.
func (s *VendorOrders) addItemLine(ctx context.Context, actor authz.Actor, o *domain.VendorOrder, itemID bson.ObjectID, f lineFields) (*domain.VendorOrderLine, domain.AuditEvent, error) {
	it, err := s.st.GetItem(ctx, itemID)
	if err != nil {
		return nil, domain.AuditEvent{}, Invalid("itemId", "unknown item")
	}
	b, err := s.st.GetBatch(ctx, it.BatchID)
	if err != nil {
		return nil, domain.AuditEvent{}, mapStore(err)
	}
	if err := itemLinkable(it, b); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	existing, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, domain.AuditEvent{}, err
	}
	for _, l := range existing {
		if l.ItemID != nil && *l.ItemID == it.ID {
			return nil, domain.AuditEvent{}, Rule("item_already_on_order", "Item %q already has a line on this order.", it.Name)
		}
	}
	qty := it.ToPurchaseQuantity
	if qty < 1 {
		qty = it.Quantity
	}
	if f.Quantity != nil {
		qty = *f.Quantity
	}
	name, sku := it.Name, it.SKU
	if f.Name != nil {
		name = strings.TrimSpace(*f.Name)
	}
	if f.SKU != nil {
		sku = strings.TrimSpace(*f.SKU)
	}
	if err := validLineName(name); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	if qty < 1 {
		return nil, domain.AuditEvent{}, Invalid("quantity", "must be at least 1")
	}
	if err := s.checkPrice(o, f.UnitPrice); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	o.LineCounter++
	l := &domain.VendorOrderLine{VendorOrderID: o.ID, LineNo: o.LineCounter, TeamID: it.TeamID, ItemID: &it.ID, BatchID: &b.ID,
		Name: name, SKU: sku, Quantity: qty, UnitPrice: f.UnitPrice, Status: domain.LineDraft, ExpectedQty: qty}
	if err := s.st.InsertLine(ctx, l); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	return l, s.lineEvent(actor, o, l, "vendor_order.line_added", "", ch("line", nil, lineLabel(l))), nil
}

func lineLabel(l *domain.VendorOrderLine) string {
	p := "no price"
	if l.UnitPrice != nil {
		p = l.UnitPrice.String()
	}
	return "#" + itoa(l.LineNo) + " " + l.Name + " x" + itoa(l.Quantity) + " @ " + p
}

// ---- lines ----

func (s *VendorOrders) requireDraft(o *domain.VendorOrder) error {
	if o.Status != domain.OrderDraft {
		return Rule("order_not_draft", "Lines can only be added or removed while the order is a draft.")
	}
	return nil
}

type AddLineInput struct {
	ItemID *bson.ObjectID
	lineFields
}

// NewAddLineInput builds the add-line input (itemId or teamId is required).
func NewAddLineInput(itemID, teamID *bson.ObjectID, name, sku *string, qty *int, price *domain.Decimal) AddLineInput {
	return AddLineInput{ItemID: itemID, lineFields: lineFields{TeamID: teamID, Name: name, SKU: sku, Quantity: qty, UnitPrice: price}}
}

// AddLine adds a line to a draft order: linked to an item, or standalone with a team.
func (s *VendorOrders) AddLine(ctx context.Context, actor authz.Actor, orderID bson.ObjectID, version int64, in AddLineInput) (*OrderDetail, error) {
	if (in.ItemID == nil) == (in.TeamID == nil) {
		return nil, Invalid("itemId", "give exactly one of itemId and teamId")
	}
	return s.mutate(ctx, actor, orderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if err := s.requireDraft(o); err != nil {
			return nil, err
		}
		if in.ItemID != nil {
			_, ev, err := s.addItemLine(ctx, actor, o, *in.ItemID, in.lineFields)
			if err != nil {
				return nil, err
			}
			return &orderMutation{events: []domain.AuditEvent{ev}}, nil
		}
		if in.Name == nil || validLineName(*in.Name) != nil {
			return nil, Invalid("name", "required, at most 300 characters")
		}
		qty := 1
		if in.Quantity != nil {
			qty = *in.Quantity
		}
		if qty < 1 {
			return nil, Invalid("quantity", "must be at least 1")
		}
		if err := s.checkPrice(o, in.UnitPrice); err != nil {
			return nil, err
		}
		if _, err := s.st.GetTeam(ctx, *in.TeamID); err != nil {
			return nil, Invalid("teamId", "unknown team")
		}
		sku := ""
		if in.SKU != nil {
			sku = strings.TrimSpace(*in.SKU)
		}
		o.LineCounter++
		l := &domain.VendorOrderLine{VendorOrderID: o.ID, LineNo: o.LineCounter, TeamID: *in.TeamID, Name: strings.TrimSpace(*in.Name), SKU: sku,
			Quantity: qty, UnitPrice: in.UnitPrice, Status: domain.LineDraft, ExpectedQty: qty}
		if err := s.st.InsertLine(ctx, l); err != nil {
			return nil, err
		}
		return &orderMutation{events: []domain.AuditEvent{s.lineEvent(actor, o, l, "vendor_order.line_added", "", ch("line", nil, lineLabel(l)))}}, nil
	})
}

// ReplaceLine replaces the editable fields of a line. After placing, only the
// unit price (never back to null), name and SKU may change (spec §10.3).
func (s *VendorOrders) ReplaceLine(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, f lineFields) (*OrderDetail, error) {
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	l0, err := s.st.GetLine(ctx, lineID)
	if err != nil {
		return nil, mapStore(err)
	}
	return s.mutate(ctx, actor, l0.VendorOrderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		l, err := s.st.GetLine(ctx, lineID)
		if err != nil {
			return nil, mapStore(err)
		}
		if o.Status == domain.OrderCancelled {
			return nil, Rule("invalid_transition", "A cancelled order cannot be edited.")
		}
		if f.Name == nil || validLineName(*f.Name) != nil {
			return nil, Invalid("name", "required, at most 300 characters")
		}
		if f.Quantity == nil || *f.Quantity < 1 {
			return nil, Invalid("quantity", "must be at least 1")
		}
		if f.TeamID == nil {
			return nil, Invalid("teamId", "required")
		}
		sku := ""
		if f.SKU != nil {
			sku = strings.TrimSpace(*f.SKU)
		}
		if err := s.checkPrice(o, f.UnitPrice); err != nil {
			return nil, err
		}
		locked := o.Status == domain.OrderPlaced
		if locked {
			if *f.Quantity != l.Quantity || *f.TeamID != l.TeamID {
				return nil, Rule("line_locked", "Quantity and team are locked once the order is placed.")
			}
			if f.UnitPrice == nil {
				return nil, Rule("unit_price_required", "A placed line keeps its unit price.")
			}
		}
		if l.ItemID != nil && *f.TeamID != l.TeamID {
			return nil, Invalid("teamId", "a line linked to an item belongs to the item's team")
		}
		if *f.TeamID != l.TeamID {
			if _, err := s.st.GetTeam(ctx, *f.TeamID); err != nil {
				return nil, Invalid("teamId", "unknown team")
			}
		}
		name := strings.TrimSpace(*f.Name)
		var changes []domain.AuditChange
		if name != l.Name {
			changes = append(changes, ch("name", l.Name, name))
		}
		if sku != l.SKU {
			changes = append(changes, ch("sku", l.SKU, sku))
		}
		if *f.Quantity != l.Quantity {
			changes = append(changes, ch("quantity", l.Quantity, *f.Quantity))
		}
		if *f.TeamID != l.TeamID {
			changes = append(changes, ch("teamId", l.TeamID.Hex(), f.TeamID.Hex()))
		}
		if !eqDec(l.UnitPrice, f.UnitPrice) {
			changes = append(changes, ch("unitPrice", decStr(l.UnitPrice), decStr(f.UnitPrice)))
		}
		if err := s.st.UpdateLine(ctx, l.ID, bson.D{
			{Key: "name", Value: name}, {Key: "sku", Value: sku}, {Key: "quantity", Value: *f.Quantity},
			{Key: "teamId", Value: *f.TeamID}, {Key: "unitPrice", Value: f.UnitPrice},
		}); err != nil {
			return nil, err
		}
		m := &orderMutation{}
		if len(changes) > 0 {
			l.TeamID = *f.TeamID
			m.events = append(m.events, s.lineEvent(actor, o, l, "vendor_order.line_updated", "", changes...))
		}
		return m, nil
	})
}

// DeleteLine removes a line from a draft order.
func (s *VendorOrders) DeleteLine(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64) (*OrderDetail, error) {
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	l0, err := s.st.GetLine(ctx, lineID)
	if err != nil {
		return nil, mapStore(err)
	}
	return s.mutate(ctx, actor, l0.VendorOrderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if err := s.requireDraft(o); err != nil {
			return nil, err
		}
		l, err := s.st.GetLine(ctx, lineID)
		if err != nil {
			return nil, mapStore(err)
		}
		if err := s.st.DeleteLine(ctx, l.ID); err != nil {
			return nil, err
		}
		m := &orderMutation{events: []domain.AuditEvent{s.lineEvent(actor, o, l, "vendor_order.line_removed", "", ch("line", lineLabel(l), nil))}}
		if l.ItemID != nil {
			m.also = []bson.ObjectID{*l.ItemID}
		}
		return m, nil
	})
}

// ---- order fields ----

// OrderFields are the editable order fields (PUT replaces all of them).
type OrderFields struct {
	VendorID          bson.ObjectID
	Currency          string
	OwnerIDs          []bson.ObjectID // nil: unchanged
	ExternalOrderNo   string
	ChargedAmountBase *domain.Decimal
	ExpectedDelivery  string
	PaymentNote       string
}

// Replace replaces the editable fields of an order. vendorId and currency only
// change while the order is a draft.
func (s *VendorOrders) Replace(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, f OrderFields) (*OrderDetail, error) {
	return s.mutate(ctx, actor, id, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status == domain.OrderCancelled {
			return nil, Rule("invalid_transition", "A cancelled order cannot be edited.")
		}
		cur := strings.ToUpper(strings.TrimSpace(f.Currency))
		if o.Status != domain.OrderDraft && (f.VendorID != o.VendorID || cur != o.Currency) {
			return nil, Rule("order_locked", "The vendor and currency cannot change once the order is placed.")
		}
		if f.VendorID != o.VendorID {
			v, err := s.st.GetVendor(ctx, f.VendorID)
			if err != nil || !v.Active {
				return nil, Invalid("vendorId", "unknown or inactive vendor")
			}
		}
		if !contains(s.supported, cur) {
			return nil, Invalid("currency", cur+" is not a supported currency")
		}
		if utf8.RuneCountInString(f.ExternalOrderNo) > 100 || utf8.RuneCountInString(f.PaymentNote) > 1000 {
			return nil, Invalid("externalOrderNo", "too long")
		}
		if f.ExpectedDelivery != "" {
			if _, err := time.Parse("2006-01-02", f.ExpectedDelivery); err != nil {
				return nil, Invalid("expectedDeliveryDate", "must be YYYY-MM-DD")
			}
		}
		if f.ChargedAmountBase != nil {
			if f.ChargedAmountBase.IsNegative() {
				return nil, Invalid("chargedAmountBase", "must not be negative")
			}
			if !domain.FitsDigits(f.ChargedAmountBase.Decimal, s.batches.cur.Digits(s.batches.cur.Base)) {
				return nil, Invalid("chargedAmountBase", "too many fractional digits for the base currency")
			}
		}
		var newOwners []bson.ObjectID
		if f.OwnerIDs != nil {
			var err error
			if newOwners, err = s.checkOwners(ctx, f.OwnerIDs, o.OwnerIDs); err != nil {
				return nil, err
			}
		}
		var changes []domain.AuditChange
		var emit []store.EventRecord
		if f.OwnerIDs != nil && !slices.Equal(newOwners, o.OwnerIDs) && !(len(newOwners) == 0 && len(o.OwnerIDs) == 0) {
			changes = append(changes, ch("ownerIds", idHexes(o.OwnerIDs), idHexes(newOwners)))
			emit = s.ownersAdded(actor, o, o.OwnerIDs, newOwners)
			o.OwnerIDs = newOwners
		}
		if f.VendorID != o.VendorID {
			changes = append(changes, ch("vendorId", o.VendorID.Hex(), f.VendorID.Hex()))
		}
		if cur != o.Currency {
			changes = append(changes, ch("currency", o.Currency, cur))
		}
		if f.ExternalOrderNo != o.ExternalOrderNo {
			changes = append(changes, ch("externalOrderNo", o.ExternalOrderNo, f.ExternalOrderNo))
		}
		if !eqDec(f.ChargedAmountBase, o.ChargedAmountBase) {
			changes = append(changes, ch("chargedAmountBase", decStr(o.ChargedAmountBase), decStr(f.ChargedAmountBase)))
		}
		if f.ExpectedDelivery != o.ExpectedDelivery {
			changes = append(changes, ch("expectedDeliveryDate", o.ExpectedDelivery, f.ExpectedDelivery))
		}
		if f.PaymentNote != o.PaymentNote {
			changes = append(changes, ch("paymentNote", o.PaymentNote, f.PaymentNote))
		}
		o.VendorID, o.Currency, o.ExternalOrderNo = f.VendorID, cur, f.ExternalOrderNo
		o.ChargedAmountBase, o.ExpectedDelivery, o.PaymentNote = f.ChargedAmountBase, f.ExpectedDelivery, f.PaymentNote
		return &orderMutation{events: []domain.AuditEvent{s.event(actor, o, "vendor_order.updated", "", changes...)}, emit: emit}, nil
	})
}

// ---- lifecycle ----

func (s *VendorOrders) linkedItems(ctx context.Context, o *domain.VendorOrder) ([]domain.VendorOrderLine, []*domain.Item, []*domain.Batch, error) {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	var items []*domain.Item
	var batches []*domain.Batch
	seen := map[bson.ObjectID]bool{}
	for _, l := range lines {
		if l.ItemID == nil || seen[*l.ItemID] {
			continue
		}
		seen[*l.ItemID] = true
		it, err := s.st.GetItem(ctx, *l.ItemID)
		if err != nil {
			return nil, nil, nil, mapStore(err)
		}
		b, err := s.st.GetBatch(ctx, it.BatchID)
		if err != nil {
			return nil, nil, nil, mapStore(err)
		}
		items, batches = append(items, it), append(batches, b)
	}
	return lines, items, batches, nil
}

func itemEvent(it *domain.Item, b *domain.Batch, typ string, actor authz.Actor, undone bool) store.EventRecord {
	return store.EventRecord{Type: typ, Actor: actor.UserID.Hex(), TeamID: it.TeamID, BatchID: b.ID, ObjectID: it.ID.Hex(), Undone: undone}
}

// Place marks the order as placed at the vendor (spec §10.3).
func (s *VendorOrders) Place(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*OrderDetail, error) {
	return s.mutate(ctx, actor, id, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status != domain.OrderDraft {
			return nil, Rule("invalid_transition", "Only a draft order can be placed.")
		}
		lines, items, batches, err := s.linkedItems(ctx, o)
		if err != nil {
			return nil, err
		}
		if len(lines) == 0 {
			return nil, Rule("order_has_no_lines", "The order has no lines.")
		}
		for _, l := range lines {
			if l.UnitPrice == nil {
				return nil, Rule("line_missing_price", "Line #%d has no unit price.", l.LineNo)
			}
		}
		entries, err := s.st.CostEntriesByOrder(ctx, o.ID)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			if e.Voided == nil {
				if err := checkLinesScope(e.Allocation, lines); err != nil {
					return nil, err
				}
			}
		}
		m := &orderMutation{}
		for i, it := range items {
			if err := itemLinkable(it, batches[i]); err != nil {
				return nil, err
			}
			m.emit = append(m.emit, itemEvent(it, batches[i], "item.ordered", actor, false))
		}
		now := s.batches.now()
		o.Status, o.PlacedAt, o.PlacedBy = domain.OrderPlaced, &now, &actor.UserID
		m.events = []domain.AuditEvent{s.event(actor, o, "vendor_order.placed", "", ch("status", "draft", "placed"))}
		return m, nil
	})
}

// Unplace puts a placed order back to draft; refused while deliveries,
// problems, closures, refunds, extra charges or unpurchasable marks depend on it.
func (s *VendorOrders) Unplace(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*OrderDetail, error) {
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, id, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status != domain.OrderPlaced {
			return nil, Rule("invalid_transition", "Only a placed order can be unplaced.")
		}
		lines, items, batches, err := s.linkedItems(ctx, o)
		if err != nil {
			return nil, err
		}
		blockers, err := s.unplaceBlockers(ctx, o, lines, items)
		if err != nil {
			return nil, err
		}
		if len(blockers) > 0 {
			return nil, &BlockedError{Blockers: blockers}
		}
		m := &orderMutation{}
		for i, it := range items {
			m.emit = append(m.emit, itemEvent(it, batches[i], "item.ordered", actor, true))
		}
		o.Status, o.PlacedAt, o.PlacedBy = domain.OrderDraft, nil, nil
		m.events = []domain.AuditEvent{s.event(actor, o, "vendor_order.unplaced", reason, ch("status", "placed", "draft"))}
		return m, nil
	})
}

func (s *VendorOrders) unplaceBlockers(ctx context.Context, o *domain.VendorOrder, lines []domain.VendorOrderLine, items []*domain.Item) ([]Blocker, error) {
	ids := make([]bson.ObjectID, len(lines))
	for i, l := range lines {
		ids[i] = l.ID
	}
	var out []Blocker
	matches, err := s.st.ActiveMatchesByLines(ctx, ids)
	if err != nil {
		return nil, err
	}
	var dids []bson.ObjectID
	for _, m := range matches {
		dids = append(dids, m.DeliveryID)
	}
	nums, err := s.st.DeliveryNumbers(ctx, dids)
	if err != nil {
		return nil, err
	}
	seen := map[bson.ObjectID]bool{}
	for _, m := range matches {
		if !seen[m.DeliveryID] {
			seen[m.DeliveryID] = true
			out = append(out, Blocker{Type: "delivery", ID: m.DeliveryID.Hex(), Label: "DL-" + itoa(nums[m.DeliveryID])})
		}
	}
	problems, err := s.st.ActiveProblemsByLines(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, p := range problems {
		out = append(out, Blocker{Type: "problem", ID: p.ID.Hex(), Label: p.Type + " x" + itoa(p.Quantity), ParentID: o.ID.Hex()})
	}
	for _, l := range lines {
		if l.Closure != nil {
			out = append(out, Blocker{Type: "line_closure", ID: l.ID.Hex(), Label: "#" + itoa(l.LineNo) + " " + string(l.Closure.Type), ParentID: o.ID.Hex()})
		}
	}
	entries, err := s.st.CostEntriesByOrder(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Voided == nil && domain.NeedsPlacedOrder(e.Type) {
			out = append(out, Blocker{Type: "cost_entry", ID: e.ID.Hex(), Label: e.Type + " " + e.Amount.String() + " " + e.Currency, ParentID: o.ID.Hex()})
		}
	}
	for _, it := range items {
		if it.Unpurchasable != nil {
			out = append(out, Blocker{Type: "item", ID: it.ID.Hex(), Label: "#" + itoa(it.SeqNo) + " " + it.Name + " (unpurchasable)"})
		}
	}
	return out, nil
}

// Cancel cancels a draft order.
func (s *VendorOrders) Cancel(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*OrderDetail, error) {
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, id, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status != domain.OrderDraft {
			return nil, Rule("invalid_transition", "Only a draft order can be cancelled.")
		}
		o.Status = domain.OrderCancelled
		o.Cancellation = &domain.Cancellation{Reason: reason, By: actor.UserID, At: s.batches.now()}
		return &orderMutation{events: []domain.AuditEvent{s.event(actor, o, "vendor_order.cancelled", reason, ch("status", "draft", "cancelled"))}}, nil
	})
}

// Uncancel returns a cancelled order to draft when its items can still be linked.
func (s *VendorOrders) Uncancel(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*OrderDetail, error) {
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, id, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status != domain.OrderCancelled {
			return nil, Rule("invalid_transition", "Only a cancelled order can be restored.")
		}
		_, items, batches, err := s.linkedItems(ctx, o)
		if err != nil {
			return nil, err
		}
		var blockers []Blocker
		for i, it := range items {
			if itemLinkable(it, batches[i]) != nil {
				blockers = append(blockers, Blocker{Type: "item", ID: it.ID.Hex(), Label: "#" + itoa(it.SeqNo) + " " + it.Name})
			}
		}
		if len(blockers) > 0 {
			return nil, &BlockedError{Blockers: blockers}
		}
		o.Status, o.Cancellation = domain.OrderDraft, nil
		return &orderMutation{events: []domain.AuditEvent{s.event(actor, o, "vendor_order.uncancelled", reason, ch("status", "cancelled", "draft"))}}, nil
	})
}

// ---- closure ----

type CloseInput struct {
	Type   domain.LineStatus // short_accepted | not_obtained
	Reason string
	Refund *RefundInput // optional
}

// CloseLine closes the remaining quantity of a partially received line.
func (s *VendorOrders) CloseLine(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, in CloseInput) (*OrderDetail, error) {
	if in.Type != domain.LineShortAccepted && in.Type != domain.LineNotObtained {
		return nil, Invalid("type", "must be short_accepted or not_obtained")
	}
	reason, err := reasonOf(in.Reason)
	if err != nil {
		return nil, err
	}
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	l0, err := s.st.GetLine(ctx, lineID)
	if err != nil {
		return nil, mapStore(err)
	}
	return s.mutate(ctx, actor, l0.VendorOrderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		l, err := s.st.GetLine(ctx, lineID)
		if err != nil {
			return nil, mapStore(err)
		}
		if o.Status != domain.OrderPlaced || l.Closure != nil {
			return nil, Rule("invalid_transition", "Only an open line of a placed order can be closed.")
		}
		if l.ReceivedQty >= l.ExpectedQty || l.OpenProblemQty > 0 {
			return nil, Rule("line_not_closable", "Only lines that are short and have no open problem can be closed.")
		}
		cl := &domain.Closure{Type: in.Type, Reason: reason, By: actor.UserID, At: s.batches.now()}
		if in.Refund != nil {
			e, err := s.batches.refundEntry(o, l.ID, in.Refund, domain.CostSourceClosure, l.ID, reason, actor.UserID)
			if err != nil {
				return nil, err
			}
			if err := s.st.InsertCostEntry(ctx, e); err != nil {
				return nil, err
			}
			cl.RefundEntryID = &e.ID
		}
		if err := s.st.UpdateLine(ctx, l.ID, bson.D{{Key: "closure", Value: cl}}); err != nil {
			return nil, err
		}
		m := &orderMutation{events: []domain.AuditEvent{s.lineEvent(actor, o, l, "vendor_order.line_closed", reason, ch("closure", nil, string(in.Type)))}}
		m.emit = append(m.emit, lineClosedEvent(actor, o, l, false))
		if l.ItemID != nil {
			m.also = []bson.ObjectID{*l.ItemID}
		}
		return m, nil
	})
}

// ReopenLine undoes a closure; its refund entry is voided.
func (s *VendorOrders) ReopenLine(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, reason string) (*OrderDetail, error) {
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	l0, err := s.st.GetLine(ctx, lineID)
	if err != nil {
		return nil, mapStore(err)
	}
	return s.mutate(ctx, actor, l0.VendorOrderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		l, err := s.st.GetLine(ctx, lineID)
		if err != nil {
			return nil, mapStore(err)
		}
		if l.Closure == nil {
			return nil, Rule("invalid_transition", "The line is not closed.")
		}
		if l.Closure.RefundEntryID != nil {
			if err := s.st.VoidCostEntry(ctx, *l.Closure.RefundEntryID, domain.Void{Reason: "line reopened: " + reason, By: actor.UserID, At: s.batches.now()}); err != nil && !errors.Is(err, store.ErrNotFound) {
				return nil, err
			}
		}
		if err := s.st.UpdateLine(ctx, l.ID, bson.D{{Key: "closure", Value: nil}}); err != nil {
			return nil, err
		}
		return &orderMutation{
			events: []domain.AuditEvent{s.lineEvent(actor, o, l, "vendor_order.line_reopened", reason, ch("closure", string(l.Closure.Type), nil))},
			emit:   []store.EventRecord{lineClosedEvent(actor, o, l, true)},
		}, nil
	})
}

// ---- recompute job ----

// RecomputeCurrency recomputes every non-cancelled order a reference rate of
// the currency can affect (the vendor_orders.recompute job, spec §11, §13.1).
func (s *VendorOrders) RecomputeCurrency(ctx context.Context, currency string) error {
	ids, err := s.st.OrdersToRecompute(ctx, currency)
	if err != nil {
		return err
	}
	for _, id := range ids {
		err := s.st.WithTx(ctx, func(ctx context.Context) error {
			o, err := s.st.GetVendorOrder(ctx, id)
			if err != nil {
				return mapStore(err)
			}
			_, _, err = s.batches.recomputeOrder(ctx, o, recomputeOpts{})
			return err
		})
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

var _ = authz.Actor{}

// NewLineFields builds the replaceable line fields.
func NewLineFields(teamID *bson.ObjectID, name, sku *string, qty *int, price *domain.Decimal) lineFields {
	return lineFields{TeamID: teamID, Name: name, SKU: sku, Quantity: qty, UnitPrice: price}
}

func lineClosedEvent(actor authz.Actor, o *domain.VendorOrder, l *domain.VendorOrderLine, undone bool) store.EventRecord {
	return store.EventRecord{Type: "line.closed", Actor: actor.UserID.Hex(), TeamID: l.TeamID, BatchID: derefID(l.BatchID),
		ObjectID: o.ID.Hex(), Undone: undone}
}

func idHexes(ids []bson.ObjectID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.Hex()
	}
	return out
}
