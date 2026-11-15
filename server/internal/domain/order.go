package domain

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// OrderStatus is the state of a team order and of a vendor transaction
// (spec §9.1: draft | placed | cancelled).
type OrderStatus string

const (
	OrderDraft     OrderStatus = "draft"
	OrderPlaced    OrderStatus = "placed"
	OrderCancelled OrderStatus = "cancelled"
)

// Order is a team order: approved items of one batch bought from one vendor.
// The cost fields are computed (spec §11) and rewritten whenever the vendor
// transaction, an item price or an adjustment changes.
type Order struct {
	ID                  bson.ObjectID   `bson:"_id,omitempty" json:"id"`
	TeamID              bson.ObjectID   `bson:"teamId" json:"teamId"`
	BatchID             bson.ObjectID   `bson:"batchId" json:"batchId"`
	Number              int             `bson:"number" json:"number"` // per batch
	Vendor              string          `bson:"vendor" json:"vendor"`
	ItemIDs             []bson.ObjectID `bson:"itemIds" json:"itemIds"`
	VendorTransactionID *bson.ObjectID  `bson:"vendorTransactionId" json:"vendorTransactionId"`
	Status              OrderStatus     `bson:"status" json:"status"`
	ItemsCostBase       Decimal         `bson:"itemsCostBase" json:"itemsCostBase"`
	SharedCostBase      Decimal         `bson:"sharedCostBase" json:"sharedCostBase"`
	AdjustmentsBase     Decimal         `bson:"adjustmentsBase" json:"adjustmentsBase"`
	TotalBase           Decimal         `bson:"totalBase" json:"totalBase"`
	CostsProvisional    bool            `bson:"costsProvisional" json:"costsProvisional"`
	CreatedBy           bson.ObjectID   `bson:"createdBy" json:"createdBy"`
	CreatedAt           time.Time       `bson:"createdAt" json:"createdAt"`
	UpdatedAt           time.Time       `bson:"updatedAt" json:"updatedAt"`
	Version             int64           `bson:"version" json:"version"`
}

// SharedCostType classifies a vendor-transaction shared cost.
type SharedCostType string

const (
	SharedShipping SharedCostType = "shipping"
	SharedFee      SharedCostType = "fee"
	SharedTax      SharedCostType = "tax"
	SharedDiscount SharedCostType = "discount"
	SharedOther    SharedCostType = "other"
)

func (t SharedCostType) Valid() bool {
	switch t {
	case SharedShipping, SharedFee, SharedTax, SharedDiscount, SharedOther:
		return true
	}
	return false
}

// SharedCost is a cost of the whole vendor transaction, in its currency
// (discounts are negative).
type SharedCost struct {
	Type   SharedCostType `bson:"type" json:"type"`
	Amount Decimal        `bson:"amount" json:"amount"`
	Note   string         `bson:"note" json:"note"`
}

// Allocation is one order's share of the shared costs, in the transaction's
// currency. Overridden is true when it was set by hand instead of
// proportionally.
type Allocation struct {
	OrderID            bson.ObjectID `bson:"orderId" json:"orderId"`
	ShareOfSharedCosts Decimal       `bson:"shareOfSharedCosts" json:"shareOfSharedCosts"`
	Overridden         bool          `bson:"overridden" json:"overridden"`
}

// VendorTransaction is the external order: one purchase from a vendor that
// bundles one or more team orders, possibly of several teams and batches.
type VendorTransaction struct {
	ID              bson.ObjectID   `bson:"_id,omitempty" json:"id"`
	Vendor          string          `bson:"vendor" json:"vendor"`
	ExternalOrderNo string          `bson:"externalOrderNo" json:"externalOrderNo"`
	Currency        string          `bson:"currency" json:"currency"`
	OrderIDs        []bson.ObjectID `bson:"orderIds" json:"orderIds"`
	TeamIDs         []bson.ObjectID `bson:"teamIds" json:"teamIds"`
	BatchIDs        []bson.ObjectID `bson:"batchIds" json:"batchIds"`
	Status          OrderStatus     `bson:"status" json:"status"`
	PlacedAt        *time.Time      `bson:"placedAt" json:"placedAt"`
	PlacedBy        *bson.ObjectID  `bson:"placedBy" json:"placedBy"`
	SharedCosts     []SharedCost    `bson:"sharedCosts" json:"sharedCosts"`
	// ChargedAmountBase is what was actually charged, in the base currency.
	ChargedAmountBase        *Decimal      `bson:"chargedAmountBase" json:"chargedAmountBase"`
	Allocations              []Allocation  `bson:"allocations" json:"allocations"`
	AllocationOverrideReason string        `bson:"allocationOverrideReason" json:"allocationOverrideReason"`
	ExpectedDeliveryDate     *time.Time    `bson:"expectedDeliveryDate" json:"expectedDeliveryDate"`
	PaymentNote              string        `bson:"paymentNote" json:"paymentNote"`
	CreatedBy                bson.ObjectID `bson:"createdBy" json:"createdBy"`
	CreatedAt                time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt                time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version                  int64         `bson:"version" json:"version"`
}

// SharedTotal is the sum of the shared costs.
func (v VendorTransaction) SharedTotal() Decimal {
	var t Decimal
	for _, c := range v.SharedCosts {
		t.Decimal = t.Decimal.Add(c.Amount.Decimal)
	}
	return t
}

// ManualAllocation reports whether any allocation was overridden by hand.
func (v VendorTransaction) ManualAllocation() bool {
	for _, a := range v.Allocations {
		if a.Overridden {
			return true
		}
	}
	return false
}

// Adjustment is a base-currency correction of an order (refunds are
// negative), optionally tied to one item (spec §9.1).
type Adjustment struct {
	ID         bson.ObjectID  `bson:"_id,omitempty" json:"id"`
	OrderID    bson.ObjectID  `bson:"orderId" json:"orderId"`
	TeamID     bson.ObjectID  `bson:"teamId" json:"teamId"`
	ItemID     *bson.ObjectID `bson:"itemId" json:"itemId"`
	AmountBase Decimal        `bson:"amountBase" json:"amountBase"`
	Reason     string         `bson:"reason" json:"reason"`
	CreatedBy  bson.ObjectID  `bson:"createdBy" json:"createdBy"`
	CreatedAt  time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt  time.Time      `bson:"updatedAt" json:"updatedAt"`
	Version    int64          `bson:"version" json:"version"`
}

// Business-rule errors of the cost calculation.
var (
	ErrAllocationSum  = errors.New("allocation_sum_mismatch")
	ErrCostBasisZero  = errors.New("cost_basis_zero")
	errAllocationSize = errors.New("allocation count does not match the orders")
)
