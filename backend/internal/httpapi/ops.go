package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ReadyCheck reports whether a dependency is usable.
type ReadyCheck func(ctx context.Context) error

// OpsHandler serves /healthz, /readyz and /metrics (spec §16.2).
func OpsHandler(reg prometheus.Gatherer, checks map[string]ReadyCheck) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		for name, check := range checks {
			if err := check(ctx); err != nil {
				// Do not leak error detail; log at caller if needed.
				http.Error(w, name+" not ready", http.StatusServiceUnavailable)
				return
			}
		}
		_, _ = w.Write([]byte("ready"))
	})
	mux.Handle("GET /metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	return mux
}
