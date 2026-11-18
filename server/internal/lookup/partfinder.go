package lookup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// Partfinder calls part-finder's GET /api/v1/lookup (spec §14.2).
type Partfinder struct {
	BaseURL         string
	DefaultCurrency string // used when the response has no currency
	Timeout         time.Duration
	Client          *http.Client // optional
}

// partfinderResponse is the ONLY place that knows part-finder's response
// shape. ASSUMPTION (unconfirmed, spec §14.2 "待確認"): a single camelCase
// object; "price" is a JSON number or a numeric string; "currency" is an
// optional ISO 4217 code. Adjust this struct and toResult if part-finder's
// api/openapi.yaml differs. Unknown fields are ignored.
type partfinderResponse struct {
	Name     string          `json:"name"`
	Store    string          `json:"store"`
	SKU      string          `json:"sku"`
	URL      string          `json:"url"`
	InStock  *bool           `json:"inStock"`
	Price    json.RawMessage `json:"price"`
	Currency string          `json:"currency"`
}

func (p partfinderResponse) toResult(defaultCurrency string) (*LookupResult, error) {
	res := &LookupResult{Name: p.Name, Vendor: p.Store, SKU: p.SKU, URL: p.URL, InStock: p.InStock}
	raw := strings.Trim(strings.TrimSpace(string(p.Price)), `"`)
	if raw == "" || raw == "null" {
		return res, nil
	}
	amt, err := decimal.NewFromString(raw)
	if err != nil || amt.IsNegative() {
		return nil, fmt.Errorf("%w: unusable price %q", ErrUpstream, raw)
	}
	cur := strings.ToUpper(strings.TrimSpace(p.Currency))
	if cur == "" {
		cur = defaultCurrency
	}
	res.UnitPrice = &domain.Money{Amount: domain.Decimal{Decimal: amt}, Currency: cur}
	return res, nil
}

func (p *Partfinder) Lookup(ctx context.Context, query string) (*LookupResult, error) {
	ctx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()
	u := strings.TrimRight(p.BaseURL, "/") + "/api/v1/lookup?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUpstream, err)
	}
	req.Header.Set("Accept", "application/json")
	client := p.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, ErrTimeout
		}
		return nil, fmt.Errorf("%w: %w", ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, ErrTimeout
		}
		return nil, fmt.Errorf("%w: reading body: %w", ErrUpstream, err)
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, ErrNotFound
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		// The upstream body goes to the log only (spec §14.1).
		slog.WarnContext(ctx, "part-finder lookup failed", "status", resp.StatusCode, "body", truncate(string(body), 500))
		return nil, fmt.Errorf("%w: status %d", ErrUpstream, resp.StatusCode)
	}
	var pr partfinderResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		slog.WarnContext(ctx, "part-finder lookup: bad response", "error", err, "body", truncate(string(body), 500))
		return nil, fmt.Errorf("%w: invalid JSON", ErrUpstream)
	}
	return pr.toResult(p.DefaultCurrency)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
