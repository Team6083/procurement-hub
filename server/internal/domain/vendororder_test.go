package domain

import (
	"testing"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestDeriveLineStatus(t *testing.T) {
	short := &Closure{Type: LineShortAccepted}
	cases := []struct {
		name string
		in   LineStatusInput
		want LineStatus
	}{
		{"cancelled order", LineStatusInput{Order: OrderCancelled, Quantity: 2}, LineCancelled},
		{"draft order", LineStatusInput{Order: OrderDraft, Quantity: 2}, LineDraft},
		{"closure wins", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReceivedQty: 1, Closure: short}, LineShortAccepted},
		{"everything returned", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReturnedQty: 2}, LineNotObtained},
		{"returned but problem open", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReturnedQty: 2, OpenProblem: 1}, LineOrdered},
		{"all received", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReceivedQty: 2}, LineReceived},
		{"received less returned", LineStatusInput{Order: OrderPlaced, Quantity: 3, ReturnedQty: 1, ReceivedQty: 2}, LineReceived},
		{"open problem blocks received", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReceivedQty: 1, OpenProblem: 1}, LinePartiallyReceived},
		{"partial", LineStatusInput{Order: OrderPlaced, Quantity: 2, ReceivedQty: 1}, LinePartiallyReceived},
		{"nothing yet", LineStatusInput{Order: OrderPlaced, Quantity: 2}, LineOrdered},
	}
	for _, c := range cases {
		if got := DeriveLineStatus(c.in); got != c.want {
			t.Errorf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestOverridesMatch(t *testing.T) {
	a, b, c := bson.NewObjectID(), bson.NewObjectID(), bson.NewObjectID()
	d := func(s string) Decimal { x, _ := NewDecimal(s); return x }
	ov := []TeamCostOverride{{a, d("4")}, {b, d("6")}}
	if !OverridesMatch(ov, []bson.ObjectID{a, b, a}, decimal.NewFromInt(10)) {
		t.Error("exact cover should match")
	}
	if OverridesMatch(ov, []bson.ObjectID{a, b}, decimal.NewFromInt(11)) {
		t.Error("wrong sum must not match")
	}
	if OverridesMatch(ov, []bson.ObjectID{a, b, c}, decimal.NewFromInt(10)) {
		t.Error("missing team must not match")
	}
	if OverridesMatch(ov, []bson.ObjectID{a}, decimal.NewFromInt(10)) {
		t.Error("extra team must not match")
	}
	if SameTeams(ov, []bson.ObjectID{a, b, c}) || !SameTeams(ov, []bson.ObjectID{b, a}) {
		t.Error("SameTeams")
	}
}

func TestComputeQuantities(t *testing.T) {
	ptr := func(r *Resolution) *Resolution { return r }
	got := ComputeQuantities(
		[]DeliveryMatch{{GoodQuantity: 3}, {GoodQuantity: 5, Voided: &Void{}}},
		[]LineProblem{
			{Quantity: 1},
			{Quantity: 2, Resolution: ptr(&Resolution{Action: ResolveAccept})},
			{Quantity: 4, Resolution: ptr(&Resolution{Action: ResolveReturnNoReplace})},
			{Quantity: 8, Resolution: ptr(&Resolution{Action: ResolveExchange})},
			{Quantity: 16, Voided: &Void{}},
		})
	if got.Received != 5 || got.OpenProblem != 1 || got.Returned != 4 {
		t.Errorf("quantities = %+v", got)
	}
}
