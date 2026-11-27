package domain

import "testing"

func TestValidateItemFields(t *testing.T) {
	price, _ := NewDecimal("10")
	good := ItemFields{
		Name: "Cable", Quantity: 2, Priority: 3, Purpose: "lab",
		EstimatedUnitPrice: Money{Amount: price, Currency: "USD"},
	}
	cur := []string{"USD", "TWD", "JPY"}
	cc := Currencies{Base: "TWD", BaseDecimals: 0}
	if errs := ValidateItemFields(good, cur, cc); len(errs) != 0 {
		t.Fatalf("valid item rejected: %v", errs)
	}
	neg, _ := NewDecimal("-1")
	tests := []struct {
		name   string
		mutate func(*ItemFields)
		field  string
	}{
		{"empty name", func(f *ItemFields) { f.Name = "  " }, "name"},
		{"long name", func(f *ItemFields) { f.Name = string(make([]rune, 301)) + "x" }, "name"},
		{"zero quantity", func(f *ItemFields) { f.Quantity = 0 }, "quantity"},
		{"priority 0", func(f *ItemFields) { f.Priority = 0 }, "priority"},
		{"priority 6", func(f *ItemFields) { f.Priority = 6 }, "priority"},
		{"negative price", func(f *ItemFields) { f.EstimatedUnitPrice.Amount = neg }, "estimatedUnitPrice"},
		{"unsupported currency", func(f *ItemFields) { f.EstimatedUnitPrice.Currency = "EUR" }, "estimatedUnitPrice"},
		{"too many digits for USD", func(f *ItemFields) { f.EstimatedUnitPrice.Amount, _ = NewDecimal("1.234") }, "estimatedUnitPrice"},
		{"fraction on JPY", func(f *ItemFields) { f.EstimatedUnitPrice = Money{Amount: mustDec("1.5"), Currency: "JPY"} }, "estimatedUnitPrice"},
		{"fraction on base currency with 0 decimals", func(f *ItemFields) { f.EstimatedUnitPrice = Money{Amount: mustDec("1.5"), Currency: "TWD"} }, "estimatedUnitPrice"},
		{"javascript url", func(f *ItemFields) { f.ProductURL = "javascript:alert(1)" }, "productUrl"},
		{"ftp url", func(f *ItemFields) { f.ProductURL = "ftp://x.example/a" }, "productUrl"},
		{"url without host", func(f *ItemFields) { f.ProductURL = "https://" }, "productUrl"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := good
			tt.mutate(&f)
			if _, ok := ValidateItemFields(f, cur, cc)[tt.field]; !ok {
				t.Fatalf("expected error on %s", tt.field)
			}
		})
	}
	f := good
	f.ProductURL = "https://shop.example.org/p/1"
	if errs := ValidateItemFields(f, cur, cc); len(errs) != 0 {
		t.Fatalf("https url rejected: %v", errs)
	}
}

func mustDec(s string) Decimal { d, _ := NewDecimal(s); return d }

func TestValidateItemFieldsAcceptsAllowedDigits(t *testing.T) {
	cc := Currencies{Base: "TWD", BaseDecimals: 0}
	base := ItemFields{Name: "x", Quantity: 1, Priority: 1, Purpose: "p"}
	for _, m := range []Money{
		{Amount: mustDec("1.25"), Currency: "USD"}, {Amount: mustDec("1.250"), Currency: "USD"},
		{Amount: mustDec("100"), Currency: "JPY"}, {Amount: mustDec("500"), Currency: "TWD"},
	} {
		f := base
		f.EstimatedUnitPrice = m
		if errs := ValidateItemFields(f, []string{"USD", "JPY", "TWD"}, cc); len(errs) != 0 {
			t.Errorf("%v rejected: %v", m, errs)
		}
	}
}
