package service

import (
	"context"
	"errors"
	"strings"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

// costEntryError maps a domain cost entry validation failure to the service
// error the API reports: 400 per field, or 422 shared_cost_allocation_invalid.
func costEntryError(err error) error {
	var ee *domain.EntryError
	var ae *domain.AllocationError
	switch {
	case errors.As(err, &ee):
		return Invalid(ee.Field, ee.Message)
	case errors.As(err, &ae):
		return Rule("shared_cost_allocation_invalid", "%s", ae.Message)
	}
	return err
}

// RefundInput is the refund of a problem resolution or a manual line closure
// (spec §10.3): Amount is positive, the stored entry is negative.
type RefundInput struct {
	Currency         string
	Amount           string
	ActualAmountBase string // optional, positive
	Method           string // cash | coupon
	Note             string
}

// refundEntry builds the negative `refund` cost entry of a line (settlement
// separate, allocated to that line only). fallbackNote is used when the input
// has no note.
func (s *Batches) refundEntry(o *domain.VendorOrder, lineID bson.ObjectID, in *RefundInput, source string, sourceID bson.ObjectID, fallbackNote string, by bson.ObjectID) (*domain.CostEntry, error) {
	cur := strings.ToUpper(strings.TrimSpace(in.Currency))
	if cur == "" {
		return nil, Invalid("refund", "currency is required")
	}
	if !contains(s.supported, cur) {
		return nil, Invalid("refund", cur+" is not a supported currency")
	}
	amt, err := decimal.NewFromString(strings.TrimSpace(in.Amount))
	if err != nil || !amt.IsPositive() {
		return nil, Invalid("refund", "amount must be a positive decimal string")
	}
	if !domain.FitsDigits(amt, s.cur.Digits(cur)) {
		return nil, Invalid("refund", "too many fractional digits for "+cur)
	}
	e := &domain.CostEntry{
		VendorOrderID: o.ID, Type: domain.CostRefund, Settlement: domain.SettleSeparate, Currency: cur,
		Amount: domain.Decimal{Decimal: amt.Neg()}, Allocation: domain.Allocation{Mode: domain.AllocLines, LineIDs: []bson.ObjectID{lineID}},
		Note: in.Note, Source: source, SourceID: &sourceID, CreatedBy: by,
	}
	if strings.TrimSpace(e.Note) == "" {
		e.Note = fallbackNote
	}
	m := in.Method
	e.RefundMethod = &m
	if a := strings.TrimSpace(in.ActualAmountBase); a != "" {
		d, err := decimal.NewFromString(a)
		if err != nil || !d.IsPositive() {
			return nil, Invalid("refund", "actualAmountBase must be a positive decimal string")
		}
		if !domain.FitsDigits(d, s.cur.Digits(s.cur.Base)) {
			return nil, Invalid("refund", "too many fractional digits for the base currency")
		}
		e.ActualAmountBase = &domain.Decimal{Decimal: d.Neg()}
	}
	e.Normalize()
	if err := e.Validate(o.Currency); err != nil {
		return nil, costEntryError(err)
	}
	return e, nil
}

// CostEntryInput is the body of a manual cost entry (create and replace).
// Amounts are signed decimal strings: discounts and refunds negative.
type CostEntryInput struct {
	Type             string
	Settlement       string // empty: separate for refund and extra_charge
	Currency         string
	Amount           string
	ActualAmountBase string
	RefundMethod     string
	Allocation       domain.Allocation
	Note             string
}

func (s *VendorOrders) parseDec(field, v string, digits int, cur string) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(strings.TrimSpace(v))
	if err != nil {
		return d, Invalid(field, "must be a decimal string")
	}
	if !domain.FitsDigits(d, digits) {
		return d, Invalid(field, "too many fractional digits for "+cur)
	}
	return d, nil
}

// buildEntry parses and validates input into an entry of o (source untouched).
func (s *VendorOrders) buildEntry(o *domain.VendorOrder, in CostEntryInput, e *domain.CostEntry) error {
	cur := strings.ToUpper(strings.TrimSpace(in.Currency))
	if cur == "" {
		return Invalid("currency", "required")
	}
	if !contains(s.supported, cur) {
		return Invalid("currency", cur+" is not a supported currency")
	}
	e.Type, e.Settlement, e.Currency, e.Note = in.Type, in.Settlement, cur, in.Note
	if e.Settlement == "" && domain.NeedsPlacedOrder(e.Type) {
		e.Settlement = domain.SettleSeparate
	}
	amt, err := s.parseDec("amount", in.Amount, s.batches.cur.Digits(cur), cur)
	if err != nil {
		return err
	}
	e.Amount = domain.Decimal{Decimal: amt}
	e.ActualAmountBase = nil
	if a := strings.TrimSpace(in.ActualAmountBase); a != "" {
		base := s.batches.cur.Base
		d, err := s.parseDec("actualAmountBase", a, s.batches.cur.Digits(base), base)
		if err != nil {
			return err
		}
		e.ActualAmountBase = &domain.Decimal{Decimal: d}
	}
	e.RefundMethod = nil
	if m := in.RefundMethod; m != "" {
		e.RefundMethod = &m
	}
	e.Allocation = in.Allocation
	for i, m := range e.Allocation.Amounts {
		if !domain.FitsDigits(m.Amount.Decimal, s.batches.cur.Digits(cur)) {
			return Invalid("allocation", "too many fractional digits for "+cur+" in amount "+itoa(i+1))
		}
	}
	e.Normalize()
	if err := e.Validate(o.Currency); err != nil {
		return costEntryError(err)
	}
	return nil
}

// checkScope verifies the teams and lines an allocation names exist on the order.
func (s *VendorOrders) checkScope(ctx context.Context, o *domain.VendorOrder, a domain.Allocation) error {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return err
	}
	return checkLinesScope(a, lines)
}

func checkLinesScope(a domain.Allocation, lines []domain.VendorOrderLine) error {
	al := make([]domain.AllocLine, len(lines))
	for i, l := range lines {
		al[i] = domain.AllocLine{ID: l.ID, TeamID: l.TeamID}
	}
	if err := domain.CheckAllocationScope(a, al); err != nil {
		return costEntryError(err)
	}
	return nil
}

func allocSummary(a domain.Allocation) string {
	switch a.Mode {
	case domain.AllocTeams:
		return "teams " + strings.Join(idHexes(a.TeamIDs), ",")
	case domain.AllocLines:
		return "lines " + strings.Join(idHexes(a.LineIDs), ",")
	case domain.AllocManual:
		parts := make([]string, len(a.Amounts))
		for i, m := range a.Amounts {
			parts[i] = m.LineID.Hex() + "=" + m.Amount.String()
		}
		return "manual " + strings.Join(parts, ",")
	}
	return "all"
}

func entryChanges(old, now *domain.CostEntry) []domain.AuditChange {
	var out []domain.AuditChange
	add := func(f string, a, b any) {
		if a != b {
			out = append(out, ch(f, a, b))
		}
	}
	method := func(e *domain.CostEntry) any {
		if e.RefundMethod == nil {
			return nil
		}
		return *e.RefundMethod
	}
	add("type", old.Type, now.Type)
	add("settlement", old.Settlement, now.Settlement)
	add("currency", old.Currency, now.Currency)
	add("amount", old.Amount.String(), now.Amount.String())
	add("actualAmountBase", decStr(old.ActualAmountBase), decStr(now.ActualAmountBase))
	add("refundMethod", method(old), method(now))
	add("allocation", allocSummary(old.Allocation), allocSummary(now.Allocation))
	add("note", old.Note, now.Note)
	return out
}

func entryLabel(e *domain.CostEntry) string {
	return e.Type + " " + e.Amount.String() + " " + e.Currency
}

func (s *VendorOrders) entryEvent(actor authz.Actor, o *domain.VendorOrder, action, comment string, changes ...domain.AuditChange) domain.AuditEvent {
	return s.event(actor, o, "vendor_order.cost_entry_"+action, comment, changes...)
}

// CreateCostEntry adds a manual cost entry. Refunds and extra charges need a
// placed order; other types also work in a draft (spec §9.1).
func (s *VendorOrders) CreateCostEntry(ctx context.Context, actor authz.Actor, orderID bson.ObjectID, version int64, in CostEntryInput) (*OrderDetail, error) {
	return s.mutate(ctx, actor, orderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status == domain.OrderCancelled {
			return nil, Rule("invalid_transition", "A cancelled order cannot be edited.")
		}
		e := &domain.CostEntry{VendorOrderID: o.ID, Source: domain.CostSourceManual, CreatedBy: actor.UserID}
		if err := s.buildEntry(o, in, e); err != nil {
			return nil, err
		}
		if domain.NeedsPlacedOrder(e.Type) && o.Status != domain.OrderPlaced {
			return nil, Rule("order_not_placed", "A %s can only be added once the order is placed.", e.Type)
		}
		if err := s.checkScope(ctx, o, e.Allocation); err != nil {
			return nil, err
		}
		if err := s.st.InsertCostEntry(ctx, e); err != nil {
			return nil, err
		}
		return &orderMutation{events: []domain.AuditEvent{s.entryEvent(actor, o, "added", e.Note, ch("costEntry", nil, entryLabel(e)))}}, nil
	})
}

// loadEntry finds an entry and its order id for a purchaser.
func (s *VendorOrders) entryOrder(ctx context.Context, actor authz.Actor, id bson.ObjectID) (bson.ObjectID, error) {
	if !actor.IsPurchaser {
		return bson.ObjectID{}, ErrForbidden
	}
	e, err := s.st.GetCostEntry(ctx, id)
	if err != nil {
		return bson.ObjectID{}, mapStore(err)
	}
	return e.VendorOrderID, nil
}

// ReplaceCostEntry replaces the editable fields of an entry (draft or placed;
// audited). Voided entries are frozen.
func (s *VendorOrders) ReplaceCostEntry(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in CostEntryInput) (*OrderDetail, error) {
	orderID, err := s.entryOrder(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, orderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		old, err := s.st.GetCostEntry(ctx, id)
		if err != nil {
			return nil, mapStore(err)
		}
		if old.Voided != nil {
			return nil, Rule("cost_entry_voided", "A voided entry cannot be edited.")
		}
		if o.Status == domain.OrderCancelled {
			return nil, Rule("invalid_transition", "A cancelled order cannot be edited.")
		}
		e := *old
		if err := s.buildEntry(o, in, &e); err != nil {
			return nil, err
		}
		if domain.NeedsPlacedOrder(e.Type) && o.Status != domain.OrderPlaced {
			return nil, Rule("order_not_placed", "A %s can only be added once the order is placed.", e.Type)
		}
		if err := s.checkScope(ctx, o, e.Allocation); err != nil {
			return nil, err
		}
		changes := entryChanges(old, &e)
		if err := s.st.UpdateCostEntry(ctx, id, bson.D{
			{Key: "type", Value: e.Type}, {Key: "settlement", Value: e.Settlement}, {Key: "currency", Value: e.Currency},
			{Key: "amount", Value: e.Amount}, {Key: "actualAmountBase", Value: e.ActualAmountBase},
			{Key: "refundMethod", Value: e.RefundMethod}, {Key: "allocation", Value: e.Allocation}, {Key: "note", Value: e.Note},
		}); err != nil {
			return nil, err
		}
		return &orderMutation{events: []domain.AuditEvent{s.entryEvent(actor, o, "updated", e.Note, changes...)}}, nil
	})
}

// DeleteCostEntry removes an entry of a draft order.
func (s *VendorOrders) DeleteCostEntry(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*OrderDetail, error) {
	orderID, err := s.entryOrder(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, orderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		if o.Status != domain.OrderDraft {
			return nil, Rule("order_not_draft", "Entries can only be deleted while the order is a draft; void them instead.")
		}
		e, err := s.st.GetCostEntry(ctx, id)
		if err != nil {
			return nil, mapStore(err)
		}
		if err := s.st.DeleteCostEntry(ctx, id); err != nil {
			return nil, err
		}
		return &orderMutation{events: []domain.AuditEvent{s.entryEvent(actor, o, "deleted", e.Note, ch("costEntry", entryLabel(e), nil))}}, nil
	})
}

// VoidCostEntry cancels an entry of a placed order. Entries made by a problem
// resolution or a line closure are voided by undoing that action.
func (s *VendorOrders) VoidCostEntry(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*OrderDetail, error) {
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	orderID, err := s.entryOrder(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	return s.mutate(ctx, actor, orderID, &version, func(ctx context.Context, o *domain.VendorOrder) (*orderMutation, error) {
		e, err := s.st.GetCostEntry(ctx, id)
		if err != nil {
			return nil, mapStore(err)
		}
		if e.Voided != nil {
			return nil, Rule("cost_entry_voided", "The entry is already voided.")
		}
		if o.Status != domain.OrderPlaced {
			return nil, Rule("order_not_placed", "Entries of a draft order are deleted, not voided.")
		}
		if e.Source == domain.CostSourceProblem || e.Source == domain.CostSourceClosure {
			return nil, &BlockedError{Blockers: []Blocker{{Type: "cost_entry", ID: e.ID.Hex(), Label: entryLabel(e) + " (from a " + e.Source + ")", ParentID: o.ID.Hex()}}}
		}
		if err := s.st.VoidCostEntry(ctx, id, domain.Void{Reason: reason, By: actor.UserID, At: s.batches.now()}); err != nil {
			return nil, mapStore(err)
		}
		return &orderMutation{events: []domain.AuditEvent{s.entryEvent(actor, o, "voided", reason, ch("costEntry", entryLabel(e), "voided"))}}, nil
	})
}
