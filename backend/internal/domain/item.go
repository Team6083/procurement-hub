package domain

import (
	"errors"
	"fmt"
)

type ItemStatus string

const (
	ItemPending           ItemStatus = "pending"
	ItemWithdrawn         ItemStatus = "withdrawn"
	ItemApproved          ItemStatus = "approved"
	ItemReturned          ItemStatus = "returned"
	ItemRejected          ItemStatus = "rejected"
	ItemOrdered           ItemStatus = "ordered"
	ItemUnpurchasable     ItemStatus = "unpurchasable"
	ItemPartiallyReceived ItemStatus = "partially_received"
	ItemReceived          ItemStatus = "received"
	ItemException         ItemStatus = "exception"
	ItemAcceptedShort     ItemStatus = "accepted_short"
	ItemNotObtained       ItemStatus = "not_obtained"
)

// IsTerminal reports states from which an item never moves (spec §10.2).
func (s ItemStatus) IsTerminal() bool {
	switch s {
	case ItemWithdrawn, ItemRejected, ItemUnpurchasable, ItemReceived, ItemAcceptedShort, ItemNotObtained:
		return true
	}
	return false
}

// ItemEvent is something that can happen to an item.
type ItemEvent string

const (
	EvWithdraw      ItemEvent = "withdraw"
	EvApprove       ItemEvent = "approve"
	EvReturn        ItemEvent = "return"
	EvReject        ItemEvent = "reject"
	EvForceReject   ItemEvent = "force_reject"
	EvResubmit      ItemEvent = "resubmit"
	EvPlaceOrder    ItemEvent = "place_order"
	EvUnpurchasable ItemEvent = "unpurchasable"
	EvReceivePart   ItemEvent = "receive_partial"
	EvReceiveFull   ItemEvent = "receive_full"
	EvReportExc     ItemEvent = "report_exception"
	EvResolveAccept ItemEvent = "resolve_accept"
	EvResolveCancel ItemEvent = "resolve_cancel"
	// EvResolveExchange keeps the item open; the target depends on whether any
	// goods were already received (spec §10.2).
	EvResolveExchange ItemEvent = "resolve_exchange"
)

var ErrInvalidTransition = errors.New("invalid transition")

type itemKey struct {
	from ItemStatus
	ev   ItemEvent
}

var itemTable = map[itemKey]ItemStatus{
	{ItemPending, EvWithdraw}:              ItemWithdrawn,
	{ItemPending, EvApprove}:               ItemApproved,
	{ItemPending, EvReturn}:                ItemReturned,
	{ItemPending, EvReject}:                ItemRejected,
	{ItemPending, EvForceReject}:           ItemRejected,
	{ItemReturned, EvResubmit}:             ItemPending,
	{ItemReturned, EvWithdraw}:             ItemWithdrawn,
	{ItemReturned, EvForceReject}:          ItemRejected,
	{ItemApproved, EvPlaceOrder}:           ItemOrdered,
	{ItemApproved, EvUnpurchasable}:        ItemUnpurchasable,
	{ItemOrdered, EvReceivePart}:           ItemPartiallyReceived,
	{ItemOrdered, EvReceiveFull}:           ItemReceived,
	{ItemPartiallyReceived, EvReceivePart}: ItemPartiallyReceived,
	{ItemPartiallyReceived, EvReceiveFull}: ItemReceived,
	{ItemOrdered, EvReportExc}:             ItemException,
	{ItemPartiallyReceived, EvReportExc}:   ItemException,
	{ItemException, EvResolveAccept}:       ItemAcceptedShort,
	{ItemException, EvResolveCancel}:       ItemNotObtained,
}

// NextItemStatus applies an event. For EvResolveExchange pass receivedQty > 0
// when some goods were already received (→ partially_received, else → ordered).
// Reviewers' EvReject on a returned item is not allowed; only force-reject.
func NextItemStatus(from ItemStatus, ev ItemEvent, receivedQty int) (ItemStatus, error) {
	if ev == EvResolveExchange {
		if from != ItemException {
			return from, fmt.Errorf("%w: %s on %s", ErrInvalidTransition, ev, from)
		}
		if receivedQty > 0 {
			return ItemPartiallyReceived, nil
		}
		return ItemOrdered, nil
	}
	to, ok := itemTable[itemKey{from, ev}]
	if !ok {
		return from, fmt.Errorf("%w: %s on %s", ErrInvalidTransition, ev, from)
	}
	return to, nil
}

// ReceiptOutcome returns the event produced by receiving `add` more units when
// `received` of `quantity` are already in. Over-receipt is an error: extra
// goods are reported as an exception instead (spec §10.2).
func ReceiptOutcome(quantity, received, add int) (ItemEvent, error) {
	switch {
	case add < 1:
		return "", errors.New("receipt quantity must be at least 1")
	case received+add > quantity:
		return "", errors.New("receipt would exceed ordered quantity")
	case received+add == quantity:
		return EvReceiveFull, nil
	}
	return EvReceivePart, nil
}
