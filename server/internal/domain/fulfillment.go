package domain

// Fulfillment is the derived purchasing progress of an approved item (spec §10.2).
type Fulfillment string

const (
	FulfillExternal          Fulfillment = "external"
	FulfillUnpurchasable     Fulfillment = "unpurchasable"
	FulfillNotOrdered        Fulfillment = "not_ordered"
	FulfillPartiallyOrdered  Fulfillment = "partially_ordered"
	FulfillReceived          Fulfillment = "received"
	FulfillClosed            Fulfillment = "closed"
	FulfillPartiallyReceived Fulfillment = "partially_received"
	FulfillOrdered           Fulfillment = "ordered"
)

// LineStatus is the computed status of a vendor order line (spec §10.3).
type LineStatus string

const (
	LineCancelled         LineStatus = "cancelled"
	LineDraft             LineStatus = "draft"
	LineShortAccepted     LineStatus = "short_accepted"
	LineNotObtained       LineStatus = "not_obtained"
	LineReceived          LineStatus = "received"
	LinePartiallyReceived LineStatus = "partially_received"
	LineOrdered           LineStatus = "ordered"
)

// LineView is what fulfillment needs to know about one linked line on a
// non-cancelled vendor order.
type LineView struct {
	Status LineStatus
}

// FulfillmentInput is the input of DeriveFulfillment.
type FulfillmentInput struct {
	External      bool // review confirmed with purchaseOutside
	Unpurchasable bool // item carries the unpurchasable mark
	ToPurchaseQty int
	Lines         []LineView // linked lines of non-cancelled orders
}

// DeriveFulfillment evaluates the §10.2 table top-down.
func DeriveFulfillment(in FulfillmentInput) Fulfillment {
	if in.External {
		return FulfillExternal
	}
	placed, draft := 0, 0
	allReceived, allClosed, anyNotReceived, anyProgress := true, true, false, false
	for _, l := range in.Lines {
		switch l.Status {
		case LineDraft:
			draft++
			continue
		case LineCancelled:
			continue
		}
		placed++
		switch l.Status {
		case LineReceived:
			anyProgress = true
		case LineShortAccepted, LineNotObtained:
			anyProgress = true
			allReceived = false
			anyNotReceived = true
		case LinePartiallyReceived:
			anyProgress = true
			allReceived, allClosed = false, false
		default:
			allReceived, allClosed = false, false
		}
	}
	switch {
	case in.Unpurchasable && placed == 0:
		return FulfillUnpurchasable
	case placed == 0:
		return FulfillNotOrdered
	case in.ToPurchaseQty > 0 || draft > 0:
		return FulfillPartiallyOrdered
	case allReceived:
		return FulfillReceived
	case allClosed && anyNotReceived:
		return FulfillClosed
	case anyProgress:
		return FulfillPartiallyReceived
	}
	return FulfillOrdered
}

// DeriveBatchStatus gives the status of a review-confirmed batch from the
// fulfillment of its approved items (spec §10.1).
func DeriveBatchStatus(approved []Fulfillment) BatchStatus {
	if len(approved) == 0 {
		return BatchCompleted
	}
	done := true
	for _, f := range approved {
		switch f {
		case FulfillNotOrdered, FulfillPartiallyOrdered:
			return BatchPurchasing
		case FulfillReceived, FulfillClosed, FulfillUnpurchasable, FulfillExternal:
		default:
			done = false
		}
	}
	if done {
		return BatchCompleted
	}
	return BatchReceiving
}
