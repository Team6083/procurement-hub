package domain

import (
	"errors"
	"testing"
)

func TestNextItemStatus(t *testing.T) {
	ok := []struct {
		from ItemStatus
		ev   ItemEvent
		recv int
		to   ItemStatus
	}{
		{ItemPending, EvWithdraw, 0, ItemWithdrawn},
		{ItemPending, EvApprove, 0, ItemApproved},
		{ItemPending, EvReturn, 0, ItemReturned},
		{ItemPending, EvReject, 0, ItemRejected},
		{ItemPending, EvForceReject, 0, ItemRejected},
		{ItemReturned, EvResubmit, 0, ItemPending},
		{ItemReturned, EvWithdraw, 0, ItemWithdrawn},
		{ItemReturned, EvForceReject, 0, ItemRejected},
		{ItemApproved, EvPlaceOrder, 0, ItemOrdered},
		{ItemApproved, EvUnpurchasable, 0, ItemUnpurchasable},
		{ItemOrdered, EvReceivePart, 0, ItemPartiallyReceived},
		{ItemOrdered, EvReceiveFull, 0, ItemReceived},
		{ItemPartiallyReceived, EvReceiveFull, 0, ItemReceived},
		{ItemOrdered, EvReportExc, 0, ItemException},
		{ItemPartiallyReceived, EvReportExc, 0, ItemException},
		{ItemException, EvResolveExchange, 0, ItemOrdered},
		{ItemException, EvResolveExchange, 2, ItemPartiallyReceived},
		{ItemException, EvResolveAccept, 0, ItemAcceptedShort},
		{ItemException, EvResolveCancel, 0, ItemNotObtained},
	}
	for _, tt := range ok {
		got, err := NextItemStatus(tt.from, tt.ev, tt.recv)
		if err != nil || got != tt.to {
			t.Errorf("%s --%s--> got %s,%v want %s", tt.from, tt.ev, got, err, tt.to)
		}
	}

	bad := []struct {
		from ItemStatus
		ev   ItemEvent
	}{
		{ItemApproved, EvReject}, // approved is final for reviewers
		{ItemApproved, EvReturn},
		{ItemReturned, EvReject},  // only force-reject from returned
		{ItemReturned, EvApprove}, // must resubmit first
		{ItemRejected, EvApprove}, // terminal
		{ItemWithdrawn, EvResubmit},
		{ItemPending, EvPlaceOrder},    // must be approved
		{ItemOrdered, EvResolveAccept}, // needs an exception first
		{ItemReceived, EvReportExc},    // terminal
		{ItemUnpurchasable, EvPlaceOrder},
		{ItemPending, EvResolveExchange},
	}
	for _, tt := range bad {
		if _, err := NextItemStatus(tt.from, tt.ev, 0); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("%s --%s--> expected ErrInvalidTransition, got %v", tt.from, tt.ev, err)
		}
	}
}

func TestTerminalStatesHaveNoOutgoingTransitions(t *testing.T) {
	events := []ItemEvent{EvWithdraw, EvApprove, EvReturn, EvReject, EvForceReject, EvResubmit, EvPlaceOrder,
		EvUnpurchasable, EvReceivePart, EvReceiveFull, EvReportExc, EvResolveAccept, EvResolveCancel, EvResolveExchange}
	for _, s := range []ItemStatus{ItemWithdrawn, ItemRejected, ItemUnpurchasable, ItemReceived, ItemAcceptedShort, ItemNotObtained} {
		if !s.IsTerminal() {
			t.Errorf("%s should be terminal", s)
		}
		for _, ev := range events {
			if _, err := NextItemStatus(s, ev, 0); err == nil {
				t.Errorf("terminal %s accepted %s", s, ev)
			}
		}
	}
}

func TestReceiptOutcome(t *testing.T) {
	tests := []struct {
		q, recv, add int
		want         ItemEvent
		err          bool
	}{
		{10, 0, 4, EvReceivePart, false},
		{10, 4, 6, EvReceiveFull, false},
		{10, 0, 10, EvReceiveFull, false},
		{10, 8, 3, "", true}, // over-receipt must be an exception
		{10, 0, 0, "", true},
	}
	for _, tt := range tests {
		got, err := ReceiptOutcome(tt.q, tt.recv, tt.add)
		if (err != nil) != tt.err || got != tt.want {
			t.Errorf("ReceiptOutcome(%d,%d,%d) = %q,%v", tt.q, tt.recv, tt.add, got, err)
		}
	}
}
