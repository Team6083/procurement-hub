package ops

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// unmatchedRoute labels requests that matched no route (and CORS preflights
// answered before routing), so raw client paths never reach logs or labels.
const unmatchedRoute = "unmatched"

// InstrumentOptions configures Instrument.
type InstrumentOptions struct {
	Metrics *HTTPMetrics // optional
	Logger  *slog.Logger // access log; nil means slog.Default()
	// SkipLog suppresses the access log line for a request (used by the ops
	// server so successful health checks are not logged).
	SkipLog func(route string, status int) bool
}

// Instrument records metrics and writes one access log line per request:
// msg=http_request with method, route (pattern), status, duration_ms and
// request_id. It deliberately logs nothing else: no query string, headers
// (Authorization, cookies), or body. Install it after RequestID.
func Instrument(o InstrumentOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r)
			elapsed := time.Since(start)
			status := sw.statusCode()
			route := routeOf(r)
			if o.Metrics != nil {
				o.Metrics.requests.WithLabelValues(route, r.Method, strconv.Itoa(status)).Inc()
				o.Metrics.latency.WithLabelValues(route, r.Method).Observe(elapsed.Seconds())
			}
			if o.SkipLog != nil && o.SkipLog(route, status) {
				return
			}
			logger := o.Logger
			if logger == nil {
				logger = slog.Default()
			}
			// The id is added explicitly (not via ContextHandler) so the line
			// has it regardless of the handler configuration.
			logger.LogAttrs(context.Background(), slog.LevelInfo, "http_request",
				slog.String("method", r.Method),
				slog.String("route", route),
				slog.Int("status", status),
				slog.Int64("duration_ms", elapsed.Milliseconds()),
				slog.String("request_id", RequestIDFrom(r.Context())),
			)
		})
	}
}

// routeOf returns the matched route pattern: chi's (e.g.
// "/api/v1/teams/{teamId}"), else a net/http ServeMux pattern, else
// unmatchedRoute.
func routeOf(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			return p
		}
	}
	if r.Pattern != "" {
		return r.Pattern
	}
	return unmatchedRoute
}

// statusWriter captures the response status.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(c int) {
	if s.status == 0 {
		s.status = c
	}
	s.ResponseWriter.WriteHeader(c)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Flush supports streaming responses (e.g. CSV export) through the wrapper.
func (s *statusWriter) Flush() {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	_ = http.NewResponseController(s.ResponseWriter).Flush()
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusWriter) statusCode() int {
	if s.status == 0 {
		return http.StatusOK
	}
	return s.status
}
