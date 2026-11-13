// Package httpapi contains the API handlers and API-specific middleware.
// Operational concerns (request ids, access log, metrics, health) live in
// package ops.
package httpapi

import "net/http"

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
