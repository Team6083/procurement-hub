package ops

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

var generatedID = regexp.MustCompile(`^[0-9a-f]{32}$`)

func TestRequestID(t *testing.T) {
	cases := []struct {
		name, in string
		keep     bool
	}{
		{"missing", "", false},
		{"valid uuid", "3f2b8c1e-8d1a-4c55-9a0e-1f2e3d4c5b6a", true},
		{"valid mixed", "trace:abc_DEF.123", true},
		{"max length", strings.Repeat("a", 128), true},
		{"too long", strings.Repeat("a", 129), false},
		{"newline injection", "abc\nmsg=forged", false},
		{"carriage return", "abc\r", false},
		{"space", "abc def", false},
		{"quote", `abc"`, false},
		{"non-ascii", "abcé", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var seen string
			h := RequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = RequestIDFrom(r.Context()) }))
			req := httptest.NewRequest("GET", "/", nil)
			if c.in != "" {
				req.Header.Set(RequestIDHeader, c.in)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			got := rec.Header().Get(RequestIDHeader)
			if got != seen {
				t.Fatalf("header %q != context %q", got, seen)
			}
			if c.keep {
				if got != c.in {
					t.Fatalf("got %q, want the client's id %q", got, c.in)
				}
			} else if !generatedID.MatchString(got) {
				t.Fatalf("got %q, want a generated id", got)
			}
		})
	}
}

func TestContextHandlerAddsRequestID(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(NewContextHandler(slog.NewJSONHandler(&buf, nil))).With("component", "x")
	log.ErrorContext(WithRequestID(context.Background(), "rid-1"), "boom")
	log.Error("no context")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines: %q", buf.String())
	}
	var first, second map[string]any
	_ = json.Unmarshal([]byte(lines[0]), &first)
	_ = json.Unmarshal([]byte(lines[1]), &second)
	if first["request_id"] != "rid-1" || first["component"] != "x" {
		t.Errorf("first line: %v", first)
	}
	if _, ok := second["request_id"]; ok {
		t.Errorf("second line has a request_id: %v", second)
	}
}

func TestNoSniff(t *testing.T) {
	h := NoSniff(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", 500) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers: %v", rec.Header())
	}
}
