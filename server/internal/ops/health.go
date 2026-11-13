package ops

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// CheckFunc reports whether one dependency is usable.
type CheckFunc func(ctx context.Context) error

type namedCheck struct {
	name string
	fn   CheckFunc
}

// Readiness backs /readyz (spec §18.2): ready only while not shutting down
// and every registered check passes. Components register named checks with
// Add (e.g. "mongodb", "oidc", and later "migrations").
type Readiness struct {
	mu       sync.RWMutex
	checks   []namedCheck
	draining atomic.Bool
	// Timeout bounds one /readyz evaluation; zero means 3 seconds.
	Timeout time.Duration
}

// NewReadiness returns a Readiness with no checks.
func NewReadiness() *Readiness { return &Readiness{} }

// Add registers a named check. Checks run in registration order.
func (r *Readiness) Add(name string, fn CheckFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.checks = append(r.checks, namedCheck{name, fn})
}

// Drain marks the process as shutting down; /readyz answers 503 from now on.
func (r *Readiness) Drain() { r.draining.Store(true) }

// Draining reports whether Drain was called.
func (r *Readiness) Draining() bool { return r.draining.Load() }

// NotReadyError names the check that failed.
type NotReadyError struct {
	Check string // "shutdown" while draining
	Err   error
}

func (e *NotReadyError) Error() string {
	if e.Err == nil {
		return e.Check + ": not ready"
	}
	return e.Check + ": " + e.Err.Error()
}

func (e *NotReadyError) Unwrap() error { return e.Err }

// Check runs the checks in order and returns the first failure.
func (r *Readiness) Check(ctx context.Context) *NotReadyError {
	if r.Draining() {
		return &NotReadyError{Check: "shutdown"}
	}
	r.mu.RLock()
	checks := append([]namedCheck(nil), r.checks...)
	r.mu.RUnlock()
	for _, c := range checks {
		if err := c.fn(ctx); err != nil {
			return &NotReadyError{Check: c.name, Err: err}
		}
	}
	return nil
}

// HandlerOptions configures Handler.
type HandlerOptions struct {
	Gatherer  prometheus.Gatherer
	Readiness *Readiness
	Logger    *slog.Logger // nil means slog.Default()
}

// Handler serves GET /healthz, /readyz and /metrics for the ops port. Bodies
// are small JSON objects; failures name the failing check but never include
// error details (those are logged). Only failed requests are access-logged.
func Handler(o HandlerOptions) http.Handler {
	logger := o.Logger
	if logger == nil {
		logger = slog.Default()
	}
	timeout := o.Readiness.Timeout
	if timeout == 0 {
		timeout = 3 * time.Second
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeStatus(w, http.StatusOK, map[string]string{"status": "ok"}) // liveness only: no dependency checks
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		if nr := o.Readiness.Check(ctx); nr != nil {
			if nr.Err != nil {
				logger.WarnContext(r.Context(), "not ready", "check", nr.Check, "error", nr.Err)
			}
			writeStatus(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "check": nr.Check})
			return
		}
		writeStatus(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	mux.Handle("GET /metrics", promhttp.HandlerFor(o.Gatherer, promhttp.HandlerOpts{}))

	var h http.Handler = mux
	h = Instrument(InstrumentOptions{Logger: logger, SkipLog: func(_ string, status int) bool { return status < 400 }})(h)
	h = RequestID(h)
	return NoSniff(h)
}

func writeStatus(w http.ResponseWriter, status int, body map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
