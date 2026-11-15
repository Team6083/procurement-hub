package domain

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestReceive(t *testing.T) {
	tests := []struct {
		name                string
		status              ItemStatus
		quantity, recv, add int
		wantStatus          ItemStatus
		wantRecv            int
		wantErr             error
	}{
		{"first short receipt", ItemOrdered, 5, 0, 2, ItemPartiallyReceived, 2, nil},
		{"complete in one go", ItemOrdered, 5, 0, 5, ItemReceived, 5, nil},
		{"another short receipt", ItemPartiallyReceived, 5, 2, 2, ItemPartiallyReceived, 4, nil},
		{"last unit", ItemPartiallyReceived, 5, 4, 1, ItemReceived, 5, nil},
		{"single unit item", ItemOrdered, 1, 0, 1, ItemReceived, 1, nil},
		{"over-receipt from nothing", ItemOrdered, 5, 0, 6, ItemOrdered, 0, ErrReceiptExceeds},
		{"over-receipt on top", ItemPartiallyReceived, 5, 4, 2, ItemPartiallyReceived, 4, ErrReceiptExceeds},
		{"zero", ItemOrdered, 5, 0, 0, ItemOrdered, 0, ErrReceiptQuantity},
		{"negative", ItemOrdered, 5, 0, -1, ItemOrdered, 0, ErrReceiptQuantity},
		{"approved item is not received yet", ItemApproved, 5, 0, 1, ItemApproved, 0, ErrInvalidTransition},
		{"exception blocks receiving", ItemException, 5, 1, 1, ItemException, 1, ErrInvalidTransition},
		{"received is final", ItemReceived, 5, 5, 1, ItemReceived, 5, ErrReceiptExceeds},
		{"accepted_short is final", ItemAcceptedShort, 5, 2, 1, ItemAcceptedShort, 2, ErrInvalidTransition},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st, recv, err := Receive(tt.status, tt.quantity, tt.recv, tt.add)
			if !errors.Is(err, tt.wantErr) || st != tt.wantStatus || recv != tt.wantRecv {
				t.Errorf("Receive = %s, %d, %v; want %s, %d, %v", st, recv, err, tt.wantStatus, tt.wantRecv, tt.wantErr)
			}
		})
	}
}

func TestReportException(t *testing.T) {
	for _, from := range []ItemStatus{ItemOrdered, ItemPartiallyReceived} {
		if to, err := ReportException(from); err != nil || to != ItemException {
			t.Errorf("ReportException(%s) = %s, %v", from, to, err)
		}
	}
	for _, from := range []ItemStatus{ItemApproved, ItemReceived, ItemException, ItemAcceptedShort, ItemNotObtained, ItemUnpurchasable, ItemPending} {
		if _, err := ReportException(from); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("ReportException(%s) err = %v, want invalid transition", from, err)
		}
	}
}

func TestResolve(t *testing.T) {
	d := func(s string) *decimal.Decimal { v := decimal.RequireFromString(s); return &v }
	tests := []struct {
		name    string
		in      ResolveInput
		wantTo  ItemStatus
		wantAdj string // "" for none
		wantWhy string
		wantErr error
	}{
		{"exchange with nothing received", ResolveInput{Action: ActionExchange, Status: ItemException}, ItemOrdered, "", "", nil},
		{"exchange with some received", ResolveInput{Action: ActionExchange, Status: ItemException, ReceivedQty: 2}, ItemPartiallyReceived, "", "", nil},
		{"exchange needs no note", ResolveInput{Action: ActionExchange, Status: ItemException, Note: " "}, ItemOrdered, "", "", nil},
		{"accept short", ResolveInput{Action: ActionAccept, Status: ItemException, ReceivedQty: 3, Note: " vendor out of stock "}, ItemAcceptedShort, "", "vendor out of stock", nil},
		{"accept with refund", ResolveInput{Action: ActionAccept, Status: ItemException, ReceivedQty: 3, Note: "ok", Refund: d("120.5")}, ItemAcceptedShort, "-120.5", "ok", nil},
		{"accept needs a note", ResolveInput{Action: ActionAccept, Status: ItemException, ReceivedQty: 3, Note: "  "}, "", "", "", ErrNoteRequired},
		{"accept with nothing received", ResolveInput{Action: ActionAccept, Status: ItemException, Note: "ok"}, "", "", "", ErrNothingReceived},
		{"cancel", ResolveInput{Action: ActionCancel, Status: ItemException, Note: "lost"}, ItemNotObtained, "", "lost", nil},
		{"cancel with refund", ResolveInput{Action: ActionCancel, Status: ItemException, Note: "lost", Refund: d("99")}, ItemNotObtained, "-99", "lost", nil},
		{"cancel after partial receipt", ResolveInput{Action: ActionCancel, Status: ItemException, ReceivedQty: 1, Note: "lost"}, ItemNotObtained, "", "lost", nil},
		{"cancel needs a note", ResolveInput{Action: ActionCancel, Status: ItemException}, "", "", "", ErrNoteRequired},
		{"refund with exchange", ResolveInput{Action: ActionExchange, Status: ItemException, Refund: d("1")}, "", "", "", ErrRefundNotAllowed},
		{"zero refund", ResolveInput{Action: ActionCancel, Status: ItemException, Note: "x", Refund: d("0")}, "", "", "", ErrRefundNotPositive},
		{"negative refund", ResolveInput{Action: ActionCancel, Status: ItemException, Note: "x", Refund: d("-5")}, "", "", "", ErrRefundNotPositive},
		{"item without exception", ResolveInput{Action: ActionCancel, Status: ItemOrdered, Note: "x"}, "", "", "", ErrInvalidTransition},
		{"exchange of closed item", ResolveInput{Action: ActionExchange, Status: ItemAcceptedShort}, "", "", "", ErrInvalidTransition},
		{"unknown action", ResolveInput{Action: "refund", Status: ItemException}, "", "", "", ErrInvalidTransition},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := Resolve(tt.in)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			want := decimal.Zero
			if tt.wantAdj != "" {
				want = decimal.RequireFromString(tt.wantAdj)
			}
			if out.To != tt.wantTo || !out.Adjustment.Equal(want) || out.CloseReason != tt.wantWhy {
				t.Errorf("Resolve = %+v, want to=%s adj=%s why=%q", out, tt.wantTo, want, tt.wantWhy)
			}
		})
	}
}

func TestEnums(t *testing.T) {
	for _, v := range []ExceptionType{ExcQuantityMismatch, ExcWrongItem, ExcDamaged} {
		if !v.Valid() {
			t.Errorf("%s should be valid", v)
		}
	}
	for _, v := range []ExceptionAction{ActionExchange, ActionAccept, ActionCancel} {
		if !v.Valid() {
			t.Errorf("%s should be valid", v)
		}
	}
	if ExceptionType("broken").Valid() || ExceptionAction("return").Valid() || ExceptionAction("").Valid() {
		t.Error("unknown values must be invalid")
	}
	if (Exception{}).Resolved() || !(Exception{Resolution: &Resolution{}}).Resolved() {
		t.Error("Resolved follows the resolution")
	}
}

// The batch completes only when every ordered item is closed and no
// exception is open (spec §10.1).
func TestReceivingComplete(t *testing.T) {
	tests := []struct {
		name string
		c    ItemCounts
		want bool
	}{
		{"all received", ItemCounts{ItemReceived: 3}, true},
		{"mixed closed", ItemCounts{ItemReceived: 1, ItemAcceptedShort: 1, ItemNotObtained: 1, ItemUnpurchasable: 2, ItemRejected: 1}, true},
		{"still waiting", ItemCounts{ItemReceived: 2, ItemOrdered: 1}, false},
		{"partially received", ItemCounts{ItemReceived: 2, ItemPartiallyReceived: 1}, false},
		{"unresolved exception", ItemCounts{ItemReceived: 2, ItemException: 1}, false},
		{"empty", ItemCounts{}, true},
	}
	for _, tt := range tests {
		if got := ReceivingComplete(tt.c); got != tt.want {
			t.Errorf("%s: ReceivingComplete = %v, want %v", tt.name, got, tt.want)
		}
		got, changed := AutoTransition(BatchReceiving, tt.c)
		if (got == BatchCompleted) != tt.want || changed != tt.want {
			t.Errorf("%s: AutoTransition = %s, %v", tt.name, got, changed)
		}
	}
}
