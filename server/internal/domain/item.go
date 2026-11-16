package domain

import (
	"errors"
	"fmt"
)

// ItemStatus is the review-side status of an item (spec §10.2). Purchasing
// progress lives in Fulfillment.
type ItemStatus string

const (
	ItemPending   ItemStatus = "pending"
	ItemWithdrawn ItemStatus = "withdrawn"
	ItemApproved  ItemStatus = "approved"
	ItemReturned  ItemStatus = "returned"
	ItemRejected  ItemStatus = "rejected"
)

// ItemEvent is something that can happen to an item's review status.
type ItemEvent string

const (
	EvWithdraw    ItemEvent = "withdraw"
	EvApprove     ItemEvent = "approve"
	EvReturn      ItemEvent = "return"
	EvReject      ItemEvent = "reject"
	EvForceReject ItemEvent = "force_reject"
	EvResubmit    ItemEvent = "resubmit"
	// EvUndoDecision returns approved, rejected or returned items to pending.
	EvUndoDecision ItemEvent = "undo_decision"
)

var ErrInvalidTransition = errors.New("invalid transition")

type itemKey struct {
	from ItemStatus
	ev   ItemEvent
}

var itemTable = map[itemKey]ItemStatus{
	{ItemPending, EvWithdraw}:      ItemWithdrawn,
	{ItemPending, EvApprove}:       ItemApproved,
	{ItemPending, EvReturn}:        ItemReturned,
	{ItemPending, EvReject}:        ItemRejected,
	{ItemPending, EvForceReject}:   ItemRejected,
	{ItemReturned, EvResubmit}:     ItemPending,
	{ItemReturned, EvWithdraw}:     ItemWithdrawn,
	{ItemReturned, EvForceReject}:  ItemRejected,
	{ItemApproved, EvUndoDecision}: ItemPending,
	{ItemRejected, EvUndoDecision}: ItemPending,
	{ItemReturned, EvUndoDecision}: ItemPending,
}

// NextItemStatus applies an event to the review status.
func NextItemStatus(from ItemStatus, ev ItemEvent) (ItemStatus, error) {
	to, ok := itemTable[itemKey{from, ev}]
	if !ok {
		return from, fmt.Errorf("%w: %s on %s", ErrInvalidTransition, ev, from)
	}
	return to, nil
}
