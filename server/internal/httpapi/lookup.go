package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/lookup"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// lookupRatePerMinute is the per-user limit of GET /lookup (spec §14.1).
const lookupRatePerMinute = 30

// LookupAPI serves GET /api/v1/lookup (spec §14.1).
type LookupAPI struct {
	Lookups *service.Lookups

	mu      sync.Mutex
	windows map[bson.ObjectID]*rateWindow
}

type rateWindow struct {
	start time.Time
	count int
}

func (a *LookupAPI) Mount(r chi.Router) { r.Get("/lookup", a.lookup) }

// allow is a fixed one-minute window per user, kept in memory (per replica).
func (a *LookupAPI) allow(user bson.ObjectID, now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.windows == nil {
		a.windows = map[bson.ObjectID]*rateWindow{}
	}
	for id, w := range a.windows { // drop expired windows so the map stays small
		if now.Sub(w.start) >= time.Minute {
			delete(a.windows, id)
		}
	}
	w := a.windows[user]
	if w == nil {
		a.windows[user] = &rateWindow{start: now, count: 1}
		return true
	}
	if w.count >= lookupRatePerMinute {
		return false
	}
	w.count++
	return true
}

type lookupResp struct {
	Name       string         `json:"name"`
	VendorID   *bson.ObjectID `json:"vendorId"`
	VendorName string         `json:"vendorName"`
	SKU        string         `json:"sku"`
	UnitPrice  *domain.Money  `json:"unitPrice"`
	URL        string         `json:"url"`
	InStock    *bool          `json:"inStock"`
}

func (a *LookupAPI) lookup(w http.ResponseWriter, r *http.Request) {
	if a.Lookups == nil || a.Lookups.Provider == nil {
		WriteError(w, NewError(http.StatusServiceUnavailable, "lookup_disabled", "Product lookup is not enabled."))
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		fail(w, r, service.Invalid("q", "required"))
		return
	}
	if !a.allow(CallerFrom(r.Context()).User.ID, time.Now()) {
		w.Header().Set("Retry-After", "60")
		WriteError(w, NewError(http.StatusTooManyRequests, "rate_limited", "Too many lookups; try again in a minute."))
		return
	}
	res, err := a.Lookups.Lookup(r.Context(), q)
	switch {
	case err == nil:
		WriteJSON(w, http.StatusOK, lookupResp{
			Name: res.Name, VendorID: res.VendorID, VendorName: res.VendorName, SKU: res.SKU,
			UnitPrice: res.UnitPrice, URL: res.URL, InStock: res.InStock,
		})
	case errors.Is(err, lookup.ErrNotFound):
		WriteError(w, NewError(http.StatusNotFound, "lookup_not_found", "No product found."))
	case errors.Is(err, lookup.ErrTimeout):
		WriteError(w, NewError(http.StatusGatewayTimeout, "upstream_timeout", "The lookup service took too long to answer."))
	case errors.Is(err, lookup.ErrUpstream):
		slog.WarnContext(r.Context(), "lookup upstream error", "error", err)
		WriteError(w, NewError(http.StatusServiceUnavailable, "upstream_unavailable", "The lookup service is unavailable."))
	default:
		fail(w, r, err)
	}
}
