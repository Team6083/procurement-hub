package domain

import (
	"encoding/json"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestMoneyBSONRoundTrip(t *testing.T) {
	for _, s := range []string{"1234.50", "0.01", "100", "0.000001"} {
		d, err := NewDecimal(s)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := bson.Marshal(bson.M{"m": Money{Amount: d, Currency: "USD"}})
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		var out struct{ M Money }
		if err := bson.Unmarshal(raw, &out); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		if !out.M.Amount.Equal(d.Decimal) || out.M.Currency != "USD" {
			t.Errorf("%s round-tripped to %v %s", s, out.M.Amount, out.M.Currency)
		}
		// The stored type must be Decimal128, not a string or double.
		if v := bson.Raw(raw).Lookup("m", "amount"); v.Type != bson.TypeDecimal128 {
			t.Errorf("%s stored as %v", s, v.Type)
		}
	}
}

func TestMoneyJSONIsString(t *testing.T) {
	d, _ := NewDecimal("12.50")
	b, err := json.Marshal(Money{Amount: d, Currency: "TWD"})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"amount":"12.5","currency":"TWD"}` {
		t.Fatalf("got %s", b)
	}
	var m Money
	if err := json.Unmarshal([]byte(`{"amount":"7.25","currency":"USD"}`), &m); err != nil || m.Amount.String() != "7.25" {
		t.Fatalf("unmarshal: %v %+v", err, m)
	}
}
