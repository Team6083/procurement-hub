// Package httpapi contains HTTP glue: middleware, router, operational endpoints.
package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
)

// Version identifies the running build (spec §6.3).
type Version struct {
	Version string
	Commit  string
}

// VersionHeaders adds X-App-Version and X-App-Commit to every response.
func VersionHeaders(v Version) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-App-Version", v.Version)
			w.Header().Set("X-App-Commit", v.Commit)
			next.ServeHTTP(w, r)
		})
	}
}

// CORS allows only the configured exact origins (spec §7.2). No credentials.
func CORS(origins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			o := r.Header.Get("Origin")
			if o != "" && allowed[o] {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", o)
				h.Add("Vary", "Origin")
				h.Set("Access-Control-Expose-Headers", "X-App-Version, X-App-Commit, ETag")
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match")
					h.Set("Access-Control-Max-Age", "600")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// MaxBody limits JSON request bodies (spec §18). CSV import routes override.
func MaxBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

type Metrics struct {
	Requests *prometheus.CounterVec
	Latency  *prometheus.HistogramVec
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		Requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total", Help: "HTTP requests by route, method and status.",
		}, []string{"route", "method", "status"}),
		Latency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "http_request_duration_seconds", Help: "HTTP request latency by route.",
			Buckets: prometheus.DefBuckets,
		}, []string{"route", "method"}),
	}
	reg.MustRegister(m.Requests, m.Latency)
	return m
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }

// Instrument records request counts and latency labelled by route pattern.
func (m *Metrics) Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		route := "unmatched"
		if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
			route = rc.RoutePattern()
		}
		m.Requests.WithLabelValues(route, r.Method, strconv.Itoa(sw.status)).Inc()
		m.Latency.WithLabelValues(route, r.Method).Observe(time.Since(start).Seconds())
	})
}
