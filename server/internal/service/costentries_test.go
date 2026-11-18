package service

import (
	"context"
	"testing"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// A rate change recomputes orders in that currency without a charge and
// orders with a separate entry in that currency lacking an actual amount.
func TestOrdersToRecomputeCoversSeparateEntries(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	charged := &domain.Decimal{}
	n := 0
	mk := func(cur string, withCharge bool) bson.ObjectID {
		n++
		o := &domain.VendorOrder{Number: n, Currency: cur, Status: domain.OrderPlaced}
		if withCharge {
			o.ChargedAmountBase = charged
		}
		if err := st.InsertVendorOrder(ctx, o); err != nil {
			t.Fatal(err)
		}
		return o.ID
	}
	entry := func(order bson.ObjectID, cur string, actual bool, voided bool) {
		e := &domain.CostEntry{VendorOrderID: order, Type: domain.CostTax, Settlement: domain.SettleSeparate, Currency: cur,
			Amount: domain.Decimal{Decimal: decimal.NewFromInt(5)}, Allocation: domain.Allocation{Mode: domain.AllocAll}}
		if actual {
			e.ActualAmountBase = charged
		}
		if voided {
			e.Voided = &domain.Void{}
		}
		if err := st.InsertCostEntry(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	noCharge := mk("TWD", false)
	pending := mk("USD", true)
	withActual := mk("USD", true)
	voided := mk("USD", true)
	entry(pending, "TWD", false, false)
	entry(withActual, "TWD", true, false)
	entry(voided, "TWD", false, true)
	got, err := st.OrdersToRecompute(ctx, "TWD")
	if err != nil {
		t.Fatal(err)
	}
	want := map[bson.ObjectID]bool{noCharge: true, pending: true}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for _, id := range got {
		if !want[id] {
			t.Fatalf("unexpected order %v in %v", id, got)
		}
	}
}
