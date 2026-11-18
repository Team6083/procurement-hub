package domain

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// OrderStatus is the status of a vendor order (spec §10.3).
type OrderStatus string

const (
	OrderDraft     OrderStatus = "draft"
	OrderPlaced    OrderStatus = "placed"
	OrderCancelled OrderStatus = "cancelled"
)

// Cancellation records why a draft order was cancelled.
type Cancellation struct {
	Reason string        `bson:"reason" json:"reason"`
	By     bson.ObjectID `bson:"by" json:"by"`
	At     time.Time     `bson:"at" json:"at"`
}

// OrderTotals is the computed money summary of an order (spec §11).
type OrderTotals struct {
	LinesC       *Decimal     `bson:"linesC" json:"linesC"`
	CheckoutC    *Decimal     `bson:"checkoutC" json:"checkoutC"`
	OriginalC    *Decimal     `bson:"originalC" json:"originalC"`
	Factor       *Decimal     `bson:"factor" json:"factor"`
	TargetBase   *Decimal     `bson:"targetBase" json:"targetBase"`
	SeparateBase *Decimal     `bson:"separateBase" json:"separateBase"`
	NetBase      *Decimal     `bson:"netBase" json:"netBase"`
	Provisional  bool         `bson:"provisional" json:"provisional"`
	Incomplete   []Incomplete `bson:"incomplete" json:"incomplete"`
}

// VendorOrder is a purchase at one vendor (spec §9.1).
type VendorOrder struct {
	ID                bson.ObjectID   `bson:"_id,omitempty" json:"id"`
	Number            int             `bson:"number" json:"number"`
	VendorID          bson.ObjectID   `bson:"vendorId" json:"vendorId"`
	Currency          string          `bson:"currency" json:"currency"`
	Status            OrderStatus     `bson:"status" json:"status"`
	OwnerIDs          []bson.ObjectID `bson:"ownerIds" json:"ownerIds"`
	ExternalOrderNo   string          `bson:"externalOrderNo" json:"externalOrderNo"`
	PlacedAt          *time.Time      `bson:"placedAt" json:"placedAt"`
	PlacedBy          *bson.ObjectID  `bson:"placedBy" json:"placedBy"`
	ChargedAmountBase *Decimal        `bson:"chargedAmountBase" json:"chargedAmountBase"`
	ExpectedDelivery  string          `bson:"expectedDeliveryDate" json:"expectedDeliveryDate"` // YYYY-MM-DD or empty
	PaymentNote       string          `bson:"paymentNote" json:"paymentNote"`
	TeamIDs           []bson.ObjectID `bson:"teamIds" json:"teamIds"`
	BatchIDs          []bson.ObjectID `bson:"batchIds" json:"batchIds"`
	Totals            OrderTotals     `bson:"totals" json:"totals"`
	Cancellation      *Cancellation   `bson:"cancellation" json:"cancellation"`
	LineCounter       int             `bson:"lineCounter" json:"-"`
	CreatedBy         bson.ObjectID   `bson:"createdBy" json:"createdBy"`
	CreatedAt         time.Time       `bson:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time       `bson:"updatedAt" json:"updatedAt"`
	Version           int64           `bson:"version" json:"version"`
}

// Closure is a purchaser's manual closing of a line's remaining quantity.
type Closure struct {
	Type          LineStatus     `bson:"type" json:"type"` // short_accepted | not_obtained
	Reason        string         `bson:"reason" json:"reason"`
	RefundEntryID *bson.ObjectID `bson:"refundEntryId" json:"refundEntryId"`
	By            bson.ObjectID  `bson:"by" json:"by"`
	At            time.Time      `bson:"at" json:"at"`
}

// VendorOrderLine is one purchased line (spec §9.1). Version is internal.
type VendorOrderLine struct {
	ID              bson.ObjectID  `bson:"_id,omitempty" json:"id"`
	VendorOrderID   bson.ObjectID  `bson:"vendorOrderId" json:"vendorOrderId"`
	LineNo          int            `bson:"lineNo" json:"lineNo"`
	TeamID          bson.ObjectID  `bson:"teamId" json:"teamId"`
	ItemID          *bson.ObjectID `bson:"itemId" json:"itemId"`
	BatchID         *bson.ObjectID `bson:"batchId" json:"batchId"`
	Name            string         `bson:"name" json:"name"`
	SKU             string         `bson:"sku" json:"sku"`
	Quantity        int            `bson:"quantity" json:"quantity"`
	UnitPrice       *Decimal       `bson:"unitPrice" json:"unitPrice"`
	ReturnedQty     int            `bson:"returnedQuantity" json:"returnedQuantity"`
	ExpectedQty     int            `bson:"expectedQuantity" json:"expectedQuantity"`
	ReceivedQty     int            `bson:"receivedQuantity" json:"receivedQuantity"`
	OpenProblemQty  int            `bson:"openProblemQuantity" json:"openProblemQuantity"`
	Closure         *Closure       `bson:"closure" json:"closure"`
	Status          LineStatus     `bson:"status" json:"status"`
	CostBase        *Decimal       `bson:"costBase" json:"costBase"`
	SharedBase      *Decimal       `bson:"sharedBase" json:"sharedBase"`
	SeparateBase    *Decimal       `bson:"separateBase" json:"separateBase"`
	TotalBase       *Decimal       `bson:"totalBase" json:"totalBase"`
	InternalVersion int64          `bson:"version" json:"-"`
	CreatedAt       time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time      `bson:"updatedAt" json:"updatedAt"`
}

// Void marks a record as voided (undone); records are never deleted.
type Void struct {
	Reason string        `bson:"reason" json:"reason"`
	By     bson.ObjectID `bson:"by" json:"by"`
	At     time.Time     `bson:"at" json:"at"`
}

// LineStatusInput is what the §10.3 line status table needs.
type LineStatusInput struct {
	Order       OrderStatus
	Closure     *Closure
	Quantity    int
	ReturnedQty int
	ReceivedQty int
	OpenProblem int
}

// DeriveLineStatus evaluates the §10.3 table top-down.
func DeriveLineStatus(in LineStatusInput) LineStatus {
	expected := in.Quantity - in.ReturnedQty
	switch {
	case in.Order == OrderCancelled:
		return LineCancelled
	case in.Order == OrderDraft:
		return LineDraft
	case in.Closure != nil:
		return in.Closure.Type
	case expected <= 0 && in.OpenProblem == 0:
		return LineNotObtained
	case in.ReceivedQty >= expected && in.OpenProblem == 0:
		return LineReceived
	case in.ReceivedQty > 0:
		return LinePartiallyReceived
	}
	return LineOrdered
}

// ---- delivery records the line quantities are derived from (spec §9.1) ----

// Problem types and resolution actions.
const (
	ProblemDamaged   = "damaged"
	ProblemWrongItem = "wrong_item"

	ResolveExchange        = "exchange"
	ResolveReturnNoReplace = "return_no_replace"
	ResolveAccept          = "accept"
)

// DeliveryMatch assigns part of a delivery line to a vendor order line.
type DeliveryMatch struct {
	ID                bson.ObjectID `bson:"_id,omitempty" json:"id"`
	DeliveryLineID    bson.ObjectID `bson:"deliveryLineId" json:"deliveryLineId"`
	DeliveryID        bson.ObjectID `bson:"deliveryId" json:"deliveryId"`
	VendorOrderLineID bson.ObjectID `bson:"vendorOrderLineId" json:"vendorOrderLineId"`
	GoodQuantity      int           `bson:"goodQuantity" json:"goodQuantity"`
	ProblemQuantity   int           `bson:"problemQuantity" json:"problemQuantity"`
	Voided            *Void         `bson:"voided" json:"voided"`
	CreatedBy         bson.ObjectID `bson:"createdBy" json:"createdBy"`
	CreatedAt         time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version           int64         `bson:"version" json:"version"`
}

// Resolution is how a purchaser settled a line problem.
type Resolution struct {
	Action        string         `bson:"action" json:"action"`
	RefundEntryID *bson.ObjectID `bson:"refundEntryId" json:"refundEntryId"`
	Note          string         `bson:"note" json:"note"`
	By            bson.ObjectID  `bson:"by" json:"by"`
	At            time.Time      `bson:"at" json:"at"`
}

// LineProblem is a damaged or wrong delivered quantity on a line.
type LineProblem struct {
	ID                bson.ObjectID  `bson:"_id,omitempty" json:"id"`
	VendorOrderLineID bson.ObjectID  `bson:"vendorOrderLineId" json:"vendorOrderLineId"`
	DeliveryMatchID   *bson.ObjectID `bson:"deliveryMatchId" json:"deliveryMatchId"`
	Quantity          int            `bson:"quantity" json:"quantity"`
	Type              string         `bson:"type" json:"type"`
	Note              string         `bson:"note" json:"note"`
	Resolution        *Resolution    `bson:"resolution" json:"resolution"`
	Voided            *Void          `bson:"voided" json:"voided"`
	CreatedAt         time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time      `bson:"updatedAt" json:"updatedAt"`
	Version           int64          `bson:"version" json:"version"`
}

// LineQuantities are the computed quantity fields of a line (spec §9.1).
type LineQuantities struct{ Received, OpenProblem, Returned int }

// ComputeQuantities derives a line's quantities from its non-voided matches
// and problems; exchange-resolved problems count in none of them.
func ComputeQuantities(matches []DeliveryMatch, problems []LineProblem) LineQuantities {
	var q LineQuantities
	for _, m := range matches {
		if m.Voided == nil {
			q.Received += m.GoodQuantity
		}
	}
	for _, p := range problems {
		if p.Voided != nil {
			continue
		}
		switch {
		case p.Resolution == nil:
			q.OpenProblem += p.Quantity
		case p.Resolution.Action == ResolveAccept:
			q.Received += p.Quantity
		case p.Resolution.Action == ResolveReturnNoReplace:
			q.Returned += p.Quantity
		}
	}
	return q
}
