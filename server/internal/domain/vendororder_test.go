package domain

import "testing"

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

func TestDeriveOrderProgress(t *testing.T) {
	final, prov := OrderTotals{}, OrderTotals{Provisional: true}
	inc := OrderTotals{Provisional: true, Incomplete: []Incomplete{{Code: IncompleteNoConversion}}}
	closed := []LineStatus{LineReceived, LineShortAccepted, LineNotObtained}
	cases := []struct {
		name  string
		order OrderStatus
		lines []LineStatus
		t     OrderTotals
		recv  string
		acc   string
		done  bool
	}{
		{"nothing yet", OrderPlaced, []LineStatus{LineOrdered, LineOrdered}, final, ReceivingNone, AccountingFinal, false},
		{"one line partly", OrderPlaced, []LineStatus{LineOrdered, LinePartiallyReceived}, final, ReceivingPartial, AccountingFinal, false},
		{"one line closed", OrderPlaced, []LineStatus{LineOrdered, LineReceived}, final, ReceivingPartial, AccountingFinal, false},
		{"all closed and final", OrderPlaced, closed, final, ReceivingClosed, AccountingFinal, true},
		{"new refund is provisional", OrderPlaced, closed, prov, ReceivingClosed, AccountingProvisional, false},
		{"incomplete wins", OrderPlaced, closed, inc, ReceivingClosed, AccountingIncomplete, false},
		{"reopened line", OrderPlaced, []LineStatus{LineReceived, LineOrdered}, final, ReceivingPartial, AccountingFinal, false},
	}
	for _, c := range cases {
		p := DeriveOrderProgress(c.order, c.lines, c.t)
		if *p.Receiving != c.recv || *p.Accounting != c.acc || *p.Completed != c.done {
			t.Errorf("%s: got %s/%s/%v", c.name, *p.Receiving, *p.Accounting, *p.Completed)
		}
	}
	for _, st := range []OrderStatus{OrderDraft, OrderCancelled} {
		if p := DeriveOrderProgress(st, closed, final); p.Receiving != nil || p.Accounting != nil || p.Completed != nil {
			t.Errorf("%s must have no progress", st)
		}
	}
}
