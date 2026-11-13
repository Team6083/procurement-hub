package ops

import "net/http"

// NoSniff sets X-Content-Type-Options: nosniff on every response, including
// errors and CORS preflights. Install it first in the chain.
func NoSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
