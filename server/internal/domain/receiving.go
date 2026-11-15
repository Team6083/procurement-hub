package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// Receiving records, exceptions and their resolution (spec §10.2). Everything
// here is pure; the service layer loads and persists.

// Receipt is one receiving record: `Quantity` units of an item arrived.
type Receipt struct {
	ID          bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ItemID      bson.ObjectID `bson:"itemId" json:"itemId"`
	OrderID     bson.ObjectID `bson:"orderId" json:"orderId"`
	TeamID      bson.ObjectID `bson:"teamId" json:"teamId"`
	Quantity    int           `bson:"quantity" json:"quantity"`
	ReceivedBy  bson.ObjectID `bson:"receivedBy" json:"receivedBy"`
	ReceivedAt  time.Time     `bson:"receivedAt" json:"receivedAt"`
	Note        string        `bson:"note" json:"note"`
	Attachments []string      `bson:"attachments" json:"attachments"` // Reserved; always empty
	CreatedAt   time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version     int64         `bson:"version" json:"version"`
}

type ExceptionType string

const (
	ExcQuantityMismatch ExceptionType = "quantity_mismatch"
	ExcWrongItem        ExceptionType = "wrong_item"
	ExcDamaged          ExceptionType = "damaged"
)

func (t ExceptionType) Valid() bool {
	switch t {
	case ExcQuantityMismatch, ExcWrongItem, ExcDamaged:
		return true
	}
	return false
}

// ExceptionAction is how an exception is dispositioned.
type ExceptionAction string

const (
	// ActionExchange covers returns and exchanges: the item goes back to
	// waiting for goods.
	ActionExchange ExceptionAction = "exchange"
	// ActionAccept closes the item with what was received.
	ActionAccept ExceptionAction = "accept"
	// ActionCancel gives up on the item (not obtained).
	ActionCancel ExceptionAction = "cancel"
)

func (a ExceptionAction) Valid() bool {
	switch a {
	case ActionExchange, ActionAccept, ActionCancel:
		return true
	}
	return false
}

// Resolution is how an exception was handled. RefundAmountBase is the refund
// as a positive amount (the adjustment it creates is negative).
type Resolution struct {
	Action           ExceptionAction `bson:"action" json:"action"`
	By               bson.ObjectID   `bson:"by" json:"by"`
	At               time.Time       `bson:"at" json:"at"`
	Note             string          `bson:"note" json:"note"`
	RefundAmountBase *Decimal        `bson:"refundAmountBase" json:"refundAmountBase"`
}

// Exception is a problem found while receiving an item.
type Exception struct {
	ID          bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ItemID      bson.ObjectID `bson:"itemId" json:"itemId"`
	TeamID      bson.ObjectID `bson:"teamId" json:"teamId"`
	Type        ExceptionType `bson:"type" json:"type"`
	Description string        `bson:"description" json:"description"`
	ReportedBy  bson.ObjectID `bson:"reportedBy" json:"reportedBy"`
	ReportedAt  time.Time     `bson:"reportedAt" json:"reportedAt"`
	Resolution  *Resolution   `bson:"resolution" json:"resolution"`
	CreatedAt   time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version     int64         `bson:"version" json:"version"`
}

// Resolved reports whether the exception has been dispositioned.
func (e Exception) Resolved() bool { return e.Resolution != nil }

// Business-rule errors of receiving.
var (
	ErrReceiptQuantity   = errors.New("receipt_quantity_invalid")
	ErrReceiptExceeds    = errors.New("receipt_exceeds_quantity")
	ErrNoteRequired      = errors.New("note_required")
	ErrRefundNotAllowed  = errors.New("refund_not_allowed")
	ErrRefundNotPositive = errors.New("refund_not_positive")
	ErrNothingReceived   = errors.New("nothing_received")
)

// Receive applies a receipt of `add` units to an item with `received` of
// `quantity` units already in. It returns the new item status and received
// quantity; short deliveries give partially_received, the last unit
// received. Over-receipt is an error: extra goods are reported as an
// exception instead (spec §10.2).
func Receive(status ItemStatus, quantity, received, add int) (ItemStatus, int, error) {
	if add < 1 {
		return status, received, ErrReceiptQuantity
	}
	if received+add > quantity {
		return status, received, ErrReceiptExceeds
	}
	ev := EvReceivePart
	if received+add == quantity {
		ev = EvReceiveFull
	}
	to, err := NextItemStatus(status, ev, received)
	if err != nil {
		return status, received, err
	}
	return to, received + add, nil
}

// ReportException moves an item into `exception`; only items waiting for
// goods (ordered, partially received) can have one.
func ReportException(status ItemStatus) (ItemStatus, error) {
	return NextItemStatus(status, EvReportExc, 0)
}

// ResolveInput is a disposition of an item's open exception.
type ResolveInput struct {
	Action      ExceptionAction
	Status      ItemStatus // must be exception
	ReceivedQty int
	Note        string
	// Refund is the refund as a positive amount; nil or zero means none.
	Refund *decimal.Decimal
}

// ResolveOutcome is the result of a disposition.
type ResolveOutcome struct {
	To ItemStatus
	// CloseReason is stored on items that are closed (accept, cancel).
	CloseReason string
	// Adjustment is the amount of the adjustment to create (negative for a
	// refund); zero when there is none.
	Adjustment decimal.Decimal
}

// Resolve dispositions an exception (spec §10.2): exchange sends the item
// back to ordered/partially_received depending on what was already
// received; accept closes it with the received quantity as the final one;
// cancel gives up on it. A refund can be recorded with accept and cancel
// only, and closing needs a note (it becomes the item's closeReason).
func Resolve(in ResolveInput) (ResolveOutcome, error) {
	var ev ItemEvent
	switch in.Action {
	case ActionExchange:
		ev = EvResolveExchange
	case ActionAccept:
		ev = EvResolveAccept
	case ActionCancel:
		ev = EvResolveCancel
	default:
		return ResolveOutcome{}, ErrInvalidTransition
	}
	to, err := NextItemStatus(in.Status, ev, in.ReceivedQty)
	if err != nil {
		return ResolveOutcome{}, err
	}
	out := ResolveOutcome{To: to}
	note := strings.TrimSpace(in.Note)
	if in.Action != ActionExchange {
		if note == "" {
			return ResolveOutcome{}, ErrNoteRequired
		}
		out.CloseReason = note
	}
	if in.Action == ActionAccept && in.ReceivedQty < 1 {
		return ResolveOutcome{}, ErrNothingReceived // nothing to accept: cancel instead
	}
	if in.Refund != nil {
		if in.Action == ActionExchange {
			return ResolveOutcome{}, ErrRefundNotAllowed
		}
		if !in.Refund.IsPositive() {
			return ResolveOutcome{}, ErrRefundNotPositive
		}
		out.Adjustment = in.Refund.Neg()
	}
	return out, nil
}

// ReceivingComplete is the batch completion rule (spec §10.1): every ordered
// item is closed and none has an unresolved exception. Counts exclude
// withdrawn items; items that never reached an order do not matter.
func ReceivingComplete(c ItemCounts) bool {
	return c.sum(receivingOpen...) == 0
}
