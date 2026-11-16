package domain

import (
	"errors"
	"testing"
)

func TestNextItemStatus(t *testing.T) {
	ok := []struct {
		from ItemStatus
		ev   ItemEvent
		to   ItemStatus
	}{
		{ItemPending, EvWithdraw, ItemWithdrawn},
		{ItemPending, EvApprove, ItemApproved},
		{ItemPending, EvReturn, ItemReturned},
		{ItemPending, EvReject, ItemRejected},
		{ItemPending, EvForceReject, ItemRejected},
		{ItemReturned, EvResubmit, ItemPending},
		{ItemReturned, EvWithdraw, ItemWithdrawn},
		{ItemReturned, EvForceReject, ItemRejected},
		{ItemApproved, EvUndoDecision, ItemPending},
		{ItemRejected, EvUndoDecision, ItemPending},
		{ItemReturned, EvUndoDecision, ItemPending},
	}
	for _, tt := range ok {
		got, err := NextItemStatus(tt.from, tt.ev)
		if err != nil || got != tt.to {
			t.Errorf("%s --%s--> got %s,%v want %s", tt.from, tt.ev, got, err, tt.to)
		}
	}
	bad := []struct {
		from ItemStatus
		ev   ItemEvent
	}{
		{ItemApproved, EvReject},
		{ItemReturned, EvReject},
		{ItemReturned, EvApprove},
		{ItemRejected, EvApprove},
		{ItemWithdrawn, EvUndoDecision},
		{ItemPending, EvUndoDecision},
	}
	for _, tt := range bad {
		if _, err := NextItemStatus(tt.from, tt.ev); !errors.Is(err, ErrInvalidTransition) {
			t.Errorf("%s --%s--> want ErrInvalidTransition, got %v", tt.from, tt.ev, err)
		}
	}
}
