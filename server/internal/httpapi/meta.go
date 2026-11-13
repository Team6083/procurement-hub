package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

type MetaInfo struct {
	BaseCurrency        string
	SupportedCurrencies []string
	LookupEnabled       bool
	EmailEnabled        bool
}

// MountMeta registers the unauthenticated GET /api/v1/meta (spec §16.2).
func MountMeta(r chi.Router, m MetaInfo) {
	r.Get("/api/v1/meta", func(w http.ResponseWriter, req *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{
			"version":             w.Header().Get("X-App-Version"),
			"commit":              w.Header().Get("X-App-Commit"),
			"baseCurrency":        m.BaseCurrency,
			"supportedCurrencies": m.SupportedCurrencies,
			"lookupEnabled":       m.LookupEnabled,
			"emailEnabled":        m.EmailEnabled,
		})
	})
}
