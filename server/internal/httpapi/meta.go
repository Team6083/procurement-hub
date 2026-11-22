package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

type MetaInfo struct {
	Build               Version
	BaseCurrency        string
	SupportedCurrencies []string
	LookupEnabled       bool
	EmailEnabled        bool
}

// MountMeta registers the unauthenticated GET /api/v1/meta (spec §16.2).
func MountMeta(r chi.Router, m MetaInfo) {
	r.Get("/api/v1/meta", func(w http.ResponseWriter, req *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{
			"build": map[string]any{
				"version": nullIf(m.Build.Version, ""),
				"commit":  nullIf(m.Build.Commit, "unknown"),
				"builtAt": nullIf(m.Build.BuiltAt, ""),
			},
			"baseCurrency":        m.BaseCurrency,
			"supportedCurrencies": m.SupportedCurrencies,
			"lookupEnabled":       m.LookupEnabled,
			"emailEnabled":        m.EmailEnabled,
		})
	})
}

// nullIf returns nil (JSON null) when s equals empty, else s.
func nullIf(s, empty string) any {
	if s == empty {
		return nil
	}
	return s
}
