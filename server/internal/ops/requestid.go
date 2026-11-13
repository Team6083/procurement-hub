package ops

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
)

// RequestIDHeader carries the request id in both directions.
const RequestIDHeader = "X-Request-ID"

// maxRequestIDLen bounds client-supplied ids; longer ones are replaced.
const maxRequestIDLen = 128

type requestIDKey struct{}

// RequestID reads X-Request-ID, or generates one when it is missing or not
// safe to log (too long, or characters outside [A-Za-z0-9._:-], which rules
// out control characters, quotes and spaces used for log injection). The id
// is stored in the request context and echoed in the response header.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if !ValidRequestID(id) {
			id = NewRequestID()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
	})
}

// ValidRequestID reports whether a client-supplied id may be used as-is.
func ValidRequestID(id string) bool {
	if id == "" || len(id) > maxRequestIDLen {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-', c == '_', c == '.', c == ':':
		default:
			return false
		}
	}
	return true
}

// NewRequestID returns 16 random bytes as 32 hex characters.
func NewRequestID() string {
	var b [16]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails
	return hex.EncodeToString(b[:])
}

// WithRequestID returns a context carrying id.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestIDFrom returns the request id in ctx, or "".
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// ContextHandler is a slog.Handler that adds request_id to every record
// logged with a context carrying one (slog.ErrorContext(r.Context(), ...)),
// so logs related to a request can be correlated with its access log line.
type ContextHandler struct{ slog.Handler }

// NewContextHandler wraps h.
func NewContextHandler(h slog.Handler) *ContextHandler { return &ContextHandler{h} }

func (h *ContextHandler) Handle(ctx context.Context, rec slog.Record) error {
	if id := RequestIDFrom(ctx); id != "" {
		rec = rec.Clone()
		rec.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, rec)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{h.Handler.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{h.Handler.WithGroup(name)}
}
