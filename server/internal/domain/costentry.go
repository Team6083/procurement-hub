package domain

import (
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// Cost entry types, settlements, sources and allocation modes (spec §9.1).
const (
	CostShipping   = "shipping"
	CostFee        = "fee"
	CostTax        = "tax"
	CostDiscount   = "discount"
	CostCouponUsed = "coupon_used"
	CostRefund     = "refund"
	CostExtra      = "extra_charge"
	CostOther      = "other"

	SettleWithCheckout = "with_checkout"
	SettleSeparate     = "separate"

	RefundCash   = "cash"
	RefundCoupon = "coupon"

	CostSourceManual  = "manual"
	CostSourceProblem = "problem"
	CostSourceClosure = "closure"

	AllocAll    = "all"
	AllocTeams  = "teams"
	AllocLines  = "lines"
	AllocManual = "manual"
)

var costTypes = map[string]bool{
	CostShipping: true, CostFee: true, CostTax: true, CostDiscount: true,
	CostCouponUsed: true, CostRefund: true, CostExtra: true, CostOther: true,
}

// ManualAmount is one line's share of a manual allocation (entry currency).
type ManualAmount struct {
	LineID bson.ObjectID `bson:"lineId" json:"lineId"`
	Amount Decimal       `bson:"amount" json:"amount"`
}

// Allocation says which lines a cost entry is split over (spec §9.1).
type Allocation struct {
	Mode    string          `bson:"mode" json:"mode"`
	TeamIDs []bson.ObjectID `bson:"teamIds,omitempty" json:"teamIds,omitempty"`
	LineIDs []bson.ObjectID `bson:"lineIds,omitempty" json:"lineIds,omitempty"`
	Amounts []ManualAmount  `bson:"amounts,omitempty" json:"amounts,omitempty"`
}

// CostEntry is money on a vendor order other than the goods (spec §9.1).
type CostEntry struct {
	ID               bson.ObjectID  `bson:"_id,omitempty" json:"id"`
	VendorOrderID    bson.ObjectID  `bson:"vendorOrderId" json:"vendorOrderId"`
	Type             string         `bson:"type" json:"type"`
	Settlement       string         `bson:"settlement" json:"settlement"`
	Currency         string         `bson:"currency" json:"currency"`
	Amount           Decimal        `bson:"amount" json:"amount"`
	ActualAmountBase *Decimal       `bson:"actualAmountBase" json:"actualAmountBase"`
	RefundMethod     *string        `bson:"refundMethod" json:"refundMethod"`
	Allocation       Allocation     `bson:"allocation" json:"allocation"`
	Note             string         `bson:"note" json:"note"`
	Source           string         `bson:"source" json:"source"`
	SourceID         *bson.ObjectID `bson:"sourceId" json:"sourceId"`
	Voided           *Void          `bson:"voided" json:"voided"`
	CreatedBy        bson.ObjectID  `bson:"createdBy" json:"createdBy"`
	CreatedAt        time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt        time.Time      `bson:"updatedAt" json:"updatedAt"`
	Version          int64          `bson:"version" json:"version"`
}

// EntryError is a field-level validation failure of a cost entry.
type EntryError struct{ Field, Message string }

func (e *EntryError) Error() string { return e.Field + ": " + e.Message }

// AllocationError is an invalid allocation (HTTP 422 shared_cost_allocation_invalid).
type AllocationError struct{ Message string }

func (e *AllocationError) Error() string { return "allocation: " + e.Message }

func badEntry(field, msg string) error { return &EntryError{Field: field, Message: msg} }
func badAlloc(msg string) error        { return &AllocationError{Message: msg} }

// NeedsPlacedOrder reports whether the type can only be added once the order
// is placed (spec §9.1: refund and extra_charge).
func NeedsPlacedOrder(typ string) bool { return typ == CostRefund || typ == CostExtra }

// Normalize fills defaults: an empty allocation means all lines, a blank
// refund method is none, and the note is trimmed.
func (e *CostEntry) Normalize() {
	if e.Allocation.Mode == "" {
		e.Allocation.Mode = AllocAll
	}
	e.Note = strings.TrimSpace(e.Note)
	if e.RefundMethod != nil && *e.RefundMethod == "" {
		e.RefundMethod = nil
	}
	if e.Source == "" {
		e.Source = CostSourceManual
	}
}

// Validate checks everything that does not need the order's lines: signs per
// type, settlement and currency rules, the refund method, the note rule and
// the shape of the allocation (spec §9.1). Digits of the amounts are checked
// by the caller, who knows the currencies. Call Normalize first.
func (e *CostEntry) Validate(orderCurrency string) error {
	if !costTypes[e.Type] {
		return badEntry("type", "must be shipping, fee, tax, discount, coupon_used, refund, extra_charge or other")
	}
	if e.Settlement != SettleWithCheckout && e.Settlement != SettleSeparate {
		return badEntry("settlement", "must be with_checkout or separate")
	}
	if NeedsPlacedOrder(e.Type) && e.Settlement != SettleSeparate {
		return badEntry("settlement", e.Type+" is always separate")
	}
	if e.Currency == "" {
		return badEntry("currency", "required")
	}
	if e.Amount.IsZero() {
		return badEntry("amount", "must not be zero")
	}
	switch e.Type {
	case CostDiscount, CostRefund:
		if !e.Amount.IsNegative() {
			return badEntry("amount", e.Type+" must be negative")
		}
	case CostCouponUsed, CostExtra:
		if !e.Amount.IsPositive() {
			return badEntry("amount", e.Type+" must be positive")
		}
	}
	if e.Settlement == SettleWithCheckout {
		if e.Currency != orderCurrency {
			return badEntry("currency", "a with_checkout entry must use the order currency")
		}
		if e.ActualAmountBase != nil {
			return badEntry("actualAmountBase", "only for separate entries")
		}
	} else if e.ActualAmountBase != nil {
		if e.ActualAmountBase.IsZero() || e.ActualAmountBase.IsNegative() != e.Amount.IsNegative() {
			return badEntry("actualAmountBase", "must be non-zero with the same sign as amount")
		}
	}
	if e.Type == CostRefund {
		if e.RefundMethod == nil || (*e.RefundMethod != RefundCash && *e.RefundMethod != RefundCoupon) {
			return badEntry("refundMethod", "must be cash or coupon for a refund")
		}
	} else if e.RefundMethod != nil {
		return badEntry("refundMethod", "only for refunds")
	}
	switch e.Source {
	case CostSourceManual, CostSourceProblem, CostSourceClosure:
	default:
		return badEntry("source", "must be manual, problem or closure")
	}
	if err := e.Allocation.validateShape(e.Amount.Decimal); err != nil {
		return err
	}
	if strings.TrimSpace(e.Note) == "" &&
		(e.Allocation.Mode != AllocAll || e.Type == CostRefund || e.Type == CostExtra || e.Type == CostCouponUsed || e.Type == CostOther) {
		return badEntry("note", "required for this type or allocation")
	}
	return nil
}

func (a Allocation) validateShape(amount decimal.Decimal) error {
	switch a.Mode {
	case AllocAll:
		if len(a.TeamIDs)+len(a.LineIDs)+len(a.Amounts) != 0 {
			return badAlloc("mode all takes no teams, lines or amounts")
		}
	case AllocTeams:
		if len(a.TeamIDs) == 0 || len(a.LineIDs) != 0 || len(a.Amounts) != 0 || hasDup(a.TeamIDs) {
			return badAlloc("mode teams needs distinct teamIds only")
		}
	case AllocLines:
		if len(a.LineIDs) == 0 || len(a.TeamIDs) != 0 || len(a.Amounts) != 0 || hasDup(a.LineIDs) {
			return badAlloc("mode lines needs distinct lineIds only")
		}
	case AllocManual:
		if len(a.Amounts) == 0 || len(a.TeamIDs) != 0 || len(a.LineIDs) != 0 {
			return badAlloc("mode manual needs amounts only")
		}
		ids := make([]bson.ObjectID, len(a.Amounts))
		sum := decimal.Zero
		for i, m := range a.Amounts {
			ids[i] = m.LineID
			sum = sum.Add(m.Amount.Decimal)
		}
		if hasDup(ids) {
			return badAlloc("manual amounts list a line twice")
		}
		if !sum.Equal(amount) {
			return badAlloc("manual amounts must add up to the entry amount")
		}
	default:
		return badAlloc("mode must be all, teams, lines or manual")
	}
	return nil
}

func hasDup(ids []bson.ObjectID) bool {
	seen := map[bson.ObjectID]bool{}
	for _, id := range ids {
		if seen[id] {
			return true
		}
		seen[id] = true
	}
	return false
}

// AllocLine is the part of a vendor order line an allocation refers to.
type AllocLine struct {
	ID     bson.ObjectID
	TeamID bson.ObjectID
}

// CheckAllocationScope verifies that the teams or lines an allocation names
// exist on the order: every named team has a line, every named line belongs to
// the order (spec §9.1).
func CheckAllocationScope(a Allocation, lines []AllocLine) error {
	teams, ids := map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}
	for _, l := range lines {
		teams[l.TeamID], ids[l.ID] = true, true
	}
	for _, t := range a.TeamIDs {
		if !teams[t] {
			return badAlloc("a named team has no line on this order")
		}
	}
	for _, id := range a.LineIDs {
		if !ids[id] {
			return badAlloc("a named line is not on this order")
		}
	}
	for _, m := range a.Amounts {
		if !ids[m.LineID] {
			return badAlloc("a named line is not on this order")
		}
	}
	return nil
}
