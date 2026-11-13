package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// The access log goes through the production middleware chain: one JSON line
// per request with the route pattern, and nothing from the token or query.
func TestHTTPAccessLogAndRequestID(t *testing.T) {
	e := newEnv(t)
	tok := e.user(t, "logger", false)
	e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(200)

	before := len(e.logs.String())
	req := httptest.NewRequest("GET", "/api/v1/batches?limit=7&cursor=", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Cookie", "sid=COOKIE-SECRET")
	req.Header.Set("X-Request-ID", "client-req-1")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-ID") != "client-req-1" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers: %v", rec.Header())
	}

	out := e.logs.String()[before:]
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 1 {
		t.Fatalf("want one access log line, got %q", out)
	}
	for _, leak := range []string{tok, tok[:20], "Bearer", "COOKIE-SECRET", "limit", "cursor", "?"} {
		if strings.Contains(out, leak) {
			t.Errorf("access log leaks %q: %s", leak, out)
		}
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &line); err != nil {
		t.Fatal(err)
	}
	if line["msg"] != "http_request" || line["method"] != "GET" || line["route"] != "/api/v1/batches" ||
		line["status"] != float64(rec.Code) || line["request_id"] != "client-req-1" {
		t.Fatalf("access log line: %s", lines[0])
	}

	// An unsafe client id is replaced, never logged.
	req = httptest.NewRequest("GET", "/api/v1/meta", nil)
	req.Header.Set("X-Request-ID", "x\"}{\"forged\":1")
	rec = httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if id := rec.Header().Get("X-Request-ID"); id == "" || strings.Contains(id, "forged") {
		t.Fatalf("unsafe request id echoed: %q", id)
	}
	if strings.Contains(e.logs.String(), "forged") {
		t.Fatal("unsafe request id logged")
	}
}

func TestHTTPCommonHeadersOnPreflight(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest("OPTIONS", "/api/v1/me", nil)
	req.Header.Set("Origin", "https://app.example.org")
	req.Header.Set("Access-Control-Request-Method", "PATCH")
	req.Header.Set("Access-Control-Request-Headers", "x-request-id")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	h := rec.Header()
	if rec.Code != 204 || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Request-ID") == "" ||
		!strings.Contains(h.Get("Access-Control-Allow-Headers"), "X-Request-ID") ||
		h.Get("Access-Control-Expose-Headers") != "X-App-Version, X-App-Commit, X-Request-ID, ETag" {
		t.Fatalf("preflight: %d %v", rec.Code, h)
	}
}

// Spec §18.2: until OIDC discovery loads, authenticated operations answer
// 503 upstream_unavailable (not 401, which would make the SPA re-login), a
// missing token is still 401, and /meta needs no IdP. Once discovery loads
// the same token works.
func TestHTTPAuthBeforeDiscovery(t *testing.T) {
	e := newEnvOpts(t, nil, true)
	tok := e.user(t, "early", false)
	e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(503, "upstream_unavailable")
	e.do(t, call{method: "GET", path: "/api/v1/me"}).expect(401, "unauthenticated")
	e.do(t, call{method: "GET", path: "/api/v1/meta"}).expect(200)
	if err := e.verifier.Ready(context.Background()); err == nil {
		t.Fatal("verifier ready before discovery")
	}
	if err := e.verifier.Discover(context.Background()); err != nil {
		t.Fatal(err)
	}
	e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(200)
}
