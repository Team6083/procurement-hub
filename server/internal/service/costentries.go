package service

import (
	"errors"
	"strings"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

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
		cur = s.cur.Base // D1 stub for the old refundBase bodies
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
