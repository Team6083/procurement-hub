package domain

import (
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type Review struct {
	Decision string        `bson:"decision" json:"decision"` // approved | returned | rejected
	By       bson.ObjectID `bson:"by" json:"by"`
	At       time.Time     `bson:"at" json:"at"`
	Comment  string        `bson:"comment,omitempty" json:"comment"`
	Forced   bool          `bson:"forced" json:"forced"`
	// AtVersion is the item version this decision produced. Any later edit
	// raises item.version above it, which is how "edited since returned" is
	// detected (timestamps are unreliable: the decision's own write is later).
	AtVersion int64 `bson:"atVersion" json:"atVersion"`
}

// UnpurchasableMark records who marked an item unpurchasable and why.
type UnpurchasableMark struct {
	By     bson.ObjectID `bson:"by" json:"by"`
	At     time.Time     `bson:"at" json:"at"`
	Reason string        `bson:"reason" json:"reason"`
}

type LookupInfo struct {
	Provider         string    `bson:"provider" json:"provider"`
	FetchedAt        time.Time `bson:"fetchedAt" json:"fetchedAt"`
	AutoFilledFields []string  `bson:"autoFilledFields" json:"autoFilledFields"`
}

type Item struct {
	ID                 bson.ObjectID  `bson:"_id,omitempty" json:"id"`
	TeamID             bson.ObjectID  `bson:"teamId" json:"teamId"`
	BatchID            bson.ObjectID  `bson:"batchId" json:"batchId"`
	SeqNo              int            `bson:"seqNo" json:"seqNo"`
	RequesterID        bson.ObjectID  `bson:"requesterId" json:"requesterId"`
	SubgroupID         string         `bson:"subgroupId,omitempty" json:"subgroupId"`
	Name               string         `bson:"name" json:"name"`
	VendorID           *bson.ObjectID `bson:"vendorId,omitempty" json:"vendorId"`
	VendorName         string         `bson:"vendorName,omitempty" json:"vendorName"`
	SKU                string         `bson:"sku,omitempty" json:"sku"`
	Quantity           int            `bson:"quantity" json:"quantity"`
	EstimatedUnitPrice Money          `bson:"estimatedUnitPrice" json:"estimatedUnitPrice"`
	Priority           int            `bson:"priority" json:"priority"`
	Purpose            string         `bson:"purpose" json:"purpose"`
	Notes              string         `bson:"notes,omitempty" json:"notes"`
	ProductURL         string         `bson:"productUrl,omitempty" json:"productUrl"`
	Status             ItemStatus     `bson:"status" json:"status"`
	Review             *Review        `bson:"review" json:"review"`
	Lookup             *LookupInfo    `bson:"lookup" json:"lookup"`
	// Unpurchasable is set while the purchaser has marked the item (spec §10.2).
	Unpurchasable *UnpurchasableMark `bson:"unpurchasable,omitempty" json:"unpurchasable"`
	// Computed fields (spec §9.1); null/0 until the batch is review-confirmed.
	Fulfillment        *Fulfillment   `bson:"fulfillment" json:"fulfillment"`
	PlannedQuantity    int            `bson:"plannedQuantity" json:"plannedQuantity"`
	ToPurchaseQuantity int            `bson:"toPurchaseQuantity" json:"toPurchaseQuantity"`
	OrderedQuantity    int            `bson:"orderedQuantity" json:"orderedQuantity"`
	ReceivedQuantity   int            `bson:"receivedQuantity" json:"receivedQuantity"`
	CostBase           *Decimal       `bson:"costBase" json:"costBase"`
	CustomFields       map[string]any `bson:"customFields" json:"customFields"` // Reserved; always {}
	CreatedAt          time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt          time.Time      `bson:"updatedAt" json:"updatedAt"`
	Version            int64          `bson:"version" json:"version"`
}

// ItemFields are the user-editable item fields (spec §9.1).
type ItemFields struct {
	SubgroupID         string
	Name               string
	VendorName         string
	SKU                string
	Quantity           int
	EstimatedUnitPrice Money
	Priority           int
	Purpose            string
	Notes              string
	ProductURL         string
}

// ValidateItemFields checks required fields and formats, returning field → message.
// supportedCurrencies bounds the price currency; cur gives the allowed number
// of fractional digits per currency (spec §9).
func ValidateItemFields(f ItemFields, supportedCurrencies []string, cur Currencies) map[string]string {
	errs := map[string]string{}
	name := strings.TrimSpace(f.Name)
	if name == "" || utf8.RuneCountInString(name) > 300 {
		errs["name"] = "required, at most 300 characters"
	}
	if f.Quantity < 1 {
		errs["quantity"] = "must be at least 1"
	}
	if f.Priority < 1 || f.Priority > 5 {
		errs["priority"] = "must be between 1 and 5"
	}
	if strings.TrimSpace(f.Purpose) == "" {
		errs["purpose"] = "required"
	}
	if f.EstimatedUnitPrice.Amount.IsNegative() {
		errs["estimatedUnitPrice"] = "must not be negative"
	} else if f.EstimatedUnitPrice.Currency == "" {
		errs["estimatedUnitPrice"] = "currency is required"
	} else {
		ok := false
		for _, c := range supportedCurrencies {
			if c == f.EstimatedUnitPrice.Currency {
				ok = true
			}
		}
		if !ok {
			errs["estimatedUnitPrice"] = "unsupported currency " + f.EstimatedUnitPrice.Currency
		} else if n := cur.Digits(f.EstimatedUnitPrice.Currency); !FitsDigits(f.EstimatedUnitPrice.Amount.Decimal, n) {
			errs["estimatedUnitPrice"] = fmt.Sprintf("at most %d fractional digits for %s", n, f.EstimatedUnitPrice.Currency)
		}
	}
	if f.ProductURL != "" {
		u, err := url.Parse(f.ProductURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs["productUrl"] = "must be an http or https URL"
		}
	}
	return errs
}
