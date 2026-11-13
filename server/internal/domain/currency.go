package domain

import (
	"strings"

	"github.com/shopspring/decimal"
)

// isoMinorUnits lists ISO 4217 currencies whose minor unit is not 2 digits.
var isoMinorUnits = map[string]int{
	// 0 digits
	"BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0, "KRW": 0, "PYG": 0,
	"RWF": 0, "UGX": 0, "UYI": 0, "VND": 0, "VUV": 0, "XAF": 0, "XOF": 0, "XPF": 0,
	// 3 digits
	"BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
	// 4 digits
	"CLF": 4, "UYW": 4,
}

// Currencies resolves the number of fractional digits allowed per currency
// (spec §9): the base currency uses APP_BASE_CURRENCY_DECIMALS when set,
// everything else uses ISO 4217.
type Currencies struct {
	Base         string
	BaseDecimals int // -1 means "use the ISO default"
}

// Digits returns the minor-unit digits for a currency code.
func (c Currencies) Digits(currency string) int {
	currency = strings.ToUpper(currency)
	if currency == c.Base && c.BaseDecimals >= 0 {
		return c.BaseDecimals
	}
	if d, ok := isoMinorUnits[currency]; ok {
		return d
	}
	return 2
}

// FitsDigits reports whether d has no more than n fractional digits
// (trailing zeros do not count: "10.500" fits 1 digit).
func FitsDigits(d decimal.Decimal, n int) bool {
	return d.Truncate(int32(n)).Equal(d)
}

// MaxRateDigits is the maximum number of fractional digits of a reference rate.
const MaxRateDigits = 6
