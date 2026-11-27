package service

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/lookup"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// LookupFound is a provider result with the store mapped to the vendor list
// (spec §14.2). VendorID is nil when no active vendor matches; VendorName is
// then the store name as the provider reported it.
type LookupFound struct {
	Name       string
	VendorID   *bson.ObjectID
	VendorName string
	SKU        string
	UnitPrice  *domain.Money
	URL        string
	InStock    *bool
}

// Lookups serves product lookups. A nil Provider means lookup is disabled.
type Lookups struct {
	Provider   lookup.ProductLookupProvider
	st         *store.Store
	currencies domain.Currencies
}

func NewLookups(p lookup.ProductLookupProvider, st *store.Store, c domain.Currencies) *Lookups {
	return &Lookups{Provider: p, st: st, currencies: c}
}

func (s *Lookups) Lookup(ctx context.Context, query string) (*LookupFound, error) {
	res, err := s.Provider.Lookup(ctx, query)
	if err != nil {
		return nil, err
	}
	out := &LookupFound{Name: res.Name, VendorName: res.Vendor, SKU: res.SKU, UnitPrice: res.UnitPrice, URL: res.URL, InStock: res.InStock}
	if p := out.UnitPrice; p != nil {
		// Keep the price within the currency's minor unit so it can be saved on an item as-is.
		p.Amount = domain.Decimal{Decimal: p.Amount.Round(int32(s.currencies.Digits(p.Currency)))}
	}
	if domain.NameKey(res.Vendor) != "" {
		vendors, err := s.st.ListVendors(ctx, false)
		if err != nil {
			return nil, err
		}
		if v := matchVendor(vendors, res.Vendor); v != nil {
			id := v.ID
			out.VendorID, out.VendorName = &id, v.Name
		}
	}
	return out, nil
}

func containsKey(keys []string, key string) bool {
	for _, k := range keys {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
}

// matchVendor returns the active vendor whose name or alias a typed vendor name matches
// (case-insensitive), or nil. It is used only when an item is written (create, edit, CSV
// import) and by product lookup; reading and grouping never match names.
func matchVendor(vendors []domain.Vendor, name string) *domain.Vendor {
	key := domain.NameKey(name)
	if key == "" {
		return nil
	}
	for i := range vendors {
		if vendors[i].Active && (vendors[i].NameKey == key || containsKey(vendors[i].AliasKeys, key)) {
			return &vendors[i]
		}
	}
	return nil
}
