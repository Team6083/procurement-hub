package domain

import (
	"fmt"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/x/bsonx/bsoncore"
)

// Money is an amount with its currency. It is stored in MongoDB as Decimal128
// and serialised in JSON as a decimal string (spec §9).
type Money struct {
	Amount   Decimal `bson:"amount" json:"amount"`
	Currency string  `bson:"currency" json:"currency"`
}

// Decimal wraps decimal.Decimal with Decimal128 BSON encoding.
type Decimal struct{ decimal.Decimal }

func NewDecimal(s string) (Decimal, error) {
	d, err := decimal.NewFromString(s)
	return Decimal{d}, err
}

func (d Decimal) MarshalBSONValue() (byte, []byte, error) {
	d128, err := bson.ParseDecimal128(d.Decimal.String())
	if err != nil {
		return 0, nil, fmt.Errorf("decimal128: %w", err)
	}
	h, l := d128.GetBytes()
	return byte(bson.TypeDecimal128), bsoncore.AppendDecimal128(nil, h, l), nil
}

func (d *Decimal) UnmarshalBSONValue(t byte, data []byte) error {
	if bson.Type(t) == bson.TypeString { // legacy rows written before Decimal128
		str, _, ok := bsoncore.ReadString(data)
		if !ok {
			return fmt.Errorf("invalid string value")
		}
		v, err := decimal.NewFromString(str)
		if err != nil {
			return err
		}
		d.Decimal = v
		return nil
	}
	if bson.Type(t) != bson.TypeDecimal128 {
		return fmt.Errorf("cannot decode BSON type %v as decimal", bson.Type(t))
	}
	h, l, _, ok := bsoncore.ReadDecimal128(data)
	if !ok {
		return fmt.Errorf("invalid decimal128 value")
	}
	v, err := decimal.NewFromString(bson.NewDecimal128(h, l).String())
	if err != nil {
		return err
	}
	d.Decimal = v
	return nil
}

// MarshalJSON emits a quoted decimal string; UnmarshalJSON accepts the same.
func (d Decimal) MarshalJSON() ([]byte, error) { return d.Decimal.MarshalJSON() }

func (d *Decimal) UnmarshalJSON(b []byte) error { return d.Decimal.UnmarshalJSON(b) }
