package domain

import (
	"testing"

	"github.com/shopspring/decimal"
)

func TestCurrenciesDigits(t *testing.T) {
	iso := Currencies{Base: "USD", BaseDecimals: -1}
	override := Currencies{Base: "TWD", BaseDecimals: 0}
	tests := []struct {
		c    Currencies
		cur  string
		want int
	}{
		{iso, "USD", 2}, {iso, "JPY", 0}, {iso, "kwd", 3}, {iso, "CLF", 4}, {iso, "TWD", 2},
		{override, "TWD", 0}, // base currency override applies
		{override, "USD", 2}, // other currencies stay ISO
		{override, "JPY", 0},
		{Currencies{Base: "JPY", BaseDecimals: 2}, "JPY", 2}, // override may also add digits
	}
	for _, tt := range tests {
		if got := tt.c.Digits(tt.cur); got != tt.want {
			t.Errorf("%+v.Digits(%s) = %d, want %d", tt.c, tt.cur, got, tt.want)
		}
	}
}

func TestFitsDigits(t *testing.T) {
	d := func(s string) decimal.Decimal { return decimal.RequireFromString(s) }
	tests := []struct {
		v    string
		n    int
		want bool
	}{
		{"10", 2, true}, {"10.5", 2, true}, {"10.50", 2, true}, {"10.500", 2, true},
		{"10.505", 2, false}, {"10.5", 0, false}, {"10", 0, true}, {"0.0000001", 6, false}, {"0.000001", 6, true},
	}
	for _, tt := range tests {
		if got := FitsDigits(d(tt.v), tt.n); got != tt.want {
			t.Errorf("FitsDigits(%s,%d) = %v, want %v", tt.v, tt.n, got, tt.want)
		}
	}
}
