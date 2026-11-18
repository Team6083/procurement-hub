// Package lookup fetches product details for a SKU or product URL from an
// external provider (spec §14). The contract other providers implement is in
// docs/product-lookup.md.
package lookup

import (
	"context"
	"errors"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// Errors a provider returns. Anything else is treated as an upstream failure.
var (
	// ErrNotFound means the provider has no result for the query.
	ErrNotFound = errors.New("lookup: not found")
	// ErrTimeout means the provider did not answer within LOOKUP_TIMEOUT.
	ErrTimeout = errors.New("lookup: timeout")
	// ErrUpstream means the provider failed or could not be reached.
	ErrUpstream = errors.New("lookup: upstream error")
)

// LookupResult is what a provider found. Vendor is the provider's store name
// as-is; matching it to the vendor list happens in the service.
type LookupResult struct {
	Name      string
	Vendor    string
	SKU       string
	UnitPrice *domain.Money
	URL       string
	InStock   *bool
}

// ProductLookupProvider looks up one product. It returns ErrNotFound when
// there is no result, ErrTimeout on timeout and ErrUpstream (wrapped) for
// other failures.
type ProductLookupProvider interface {
	Lookup(ctx context.Context, query string) (*LookupResult, error)
}
