package domain

import "testing"

func TestValidateItemFields(t *testing.T) {
	price, _ := NewDecimal("10")
	good := ItemFields{
		Name: "Cable", Quantity: 2, Priority: 3, Purpose: "lab",
		EstimatedUnitPrice: Money{Amount: price, Currency: "USD"},
	}
	cur := []string{"USD", "TWD"}
	if errs := ValidateItemFields(good, cur); len(errs) != 0 {
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
		{"no purpose", func(f *ItemFields) { f.Purpose = "" }, "purpose"},
		{"negative price", func(f *ItemFields) { f.EstimatedUnitPrice.Amount = neg }, "estimatedUnitPrice"},
		{"unsupported currency", func(f *ItemFields) { f.EstimatedUnitPrice.Currency = "JPY" }, "estimatedUnitPrice"},
		{"javascript url", func(f *ItemFields) { f.ProductURL = "javascript:alert(1)" }, "productUrl"},
		{"ftp url", func(f *ItemFields) { f.ProductURL = "ftp://x.example/a" }, "productUrl"},
		{"url without host", func(f *ItemFields) { f.ProductURL = "https://" }, "productUrl"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := good
			tt.mutate(&f)
			if _, ok := ValidateItemFields(f, cur)[tt.field]; !ok {
				t.Fatalf("expected error on %s", tt.field)
			}
		})
	}
	f := good
	f.ProductURL = "https://shop.example.org/p/1"
	if errs := ValidateItemFields(f, cur); len(errs) != 0 {
		t.Fatalf("https url rejected: %v", errs)
	}
}
