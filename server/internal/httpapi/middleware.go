// Package httpapi contains the API handlers and API-specific middleware.
// Operational concerns (request ids, access log, metrics, health) live in
// package ops.
package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/team6083/procurement-hub/server/internal/ops"
)

// Version identifies the running build (spec §6.3).
type Version struct {
	Version string // empty for builds that are not a release tag
	Commit  string
	BuiltAt string // UTC ISO 8601, empty for local builds
}

// VersionHeaders adds X-App-Commit to every response, and X-App-Version when
// the build has a version.
func VersionHeaders(v Version) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if v.Version != "" {
				w.Header().Set("X-App-Version", v.Version)
			}
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
				h.Set("Access-Control-Expose-Headers", "X-App-Version, X-App-Commit, X-Request-ID, ETag")
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match, X-Request-ID")
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

// Recover turns a handler panic into 500 internal_error without details and
// logs the panic with its stack (spec §16.1). Install it inside ops.Instrument
// so the request still gets its access log line with status 500.
// http.ErrAbortHandler is re-panicked: it is net/http's way to abort a
// response deliberately.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler { //nolint:errorlint // sentinel compared by identity, as net/http does
					panic(v)
				}
				l := logger
				if l == nil {
					l = slog.Default()
				}
				// request_id is explicit (background context) so it appears
				// exactly once whatever the handler configuration.
				l.LogAttrs(context.Background(), slog.LevelError, "panic in handler",
					slog.String("panic", fmt.Sprint(v)), slog.String("stack", string(debug.Stack())),
					slog.String("request_id", ops.RequestIDFrom(r.Context())))
				WriteError(w, NewError(http.StatusInternalServerError, "internal_error", "Internal error."))
			}()
			next.ServeHTTP(w, r)
		})
	}
}
