package domain

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// Vendor is an entry of the shared vendor list (spec §9.1). Aliases let CSV
// imports and lookups map store names to the vendor; deactivate instead of delete.
type Vendor struct {
	ID              bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Name            string        `bson:"name" json:"name"`
	Aliases         []string      `bson:"aliases" json:"aliases"`
	DefaultCurrency string        `bson:"defaultCurrency" json:"defaultCurrency"`
	Website         string        `bson:"website" json:"website"`
	Notes           string        `bson:"notes" json:"notes"`
	Active          bool          `bson:"active" json:"active"`
	// NameKey and AliasKeys are the normalised forms (see NameKey) used
	// for uniqueness; AliasKeys is omitted when empty so the partial unique
	// index ignores vendors without aliases.
	NameKey   string    `bson:"nameKey" json:"-"`
	AliasKeys []string  `bson:"aliasKeys,omitempty" json:"-"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
	Version   int64     `bson:"version" json:"version"`
}

// GlobalRate is the system-wide reference rate of one currency to the base
// currency (spec §9.1); one document per currency, versioned independently.
type GlobalRate struct {
	Currency   string    `bson:"_id" json:"currency"`
	RateToBase Decimal   `bson:"rateToBase" json:"rateToBase"`
	UpdatedAt  time.Time `bson:"updatedAt" json:"updatedAt"`
	UpdatedBy  string    `bson:"updatedBy" json:"updatedBy"`
	Version    int64     `bson:"version" json:"version"`
}
