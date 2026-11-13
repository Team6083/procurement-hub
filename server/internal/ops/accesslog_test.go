package ops

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestAccessLog(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	reg := NewRegistry()
	m := NewHTTPMetrics(reg)

	r := chi.NewRouter()
	r.Use(NoSniff, RequestID, Instrument(InstrumentOptions{Metrics: m, Logger: logger}))
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/teams/{teamId}/members", func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusCreated)
		})
	})

	const (
		token  = "eyJhbGciOiJSUzI1NiJ9.SECRET-TOKEN-PAYLOAD.sig"
		cookie = "session=COOKIE-VALUE"
		query  = "search=QUERY-VALUE&email=someone%40example.org"
		body   = `{"note":"BODY-VALUE"}`
	)
	req := httptest.NewRequest("POST", "/api/v1/teams/65f0c0ffee/members?"+query, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Cookie", cookie)
	req.Header.Set(RequestIDHeader, "req-42")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	out := buf.String()
	if strings.Count(out, "\n") != 1 {
		t.Fatalf("want exactly one log line, got %q", out)
	}
	for _, secret := range []string{"SECRET-TOKEN", "Bearer", "Authorization", "COOKIE-VALUE", "session", "QUERY-VALUE",
		"search=", "someone", "BODY-VALUE", "65f0c0ffee", "?"} {
		if strings.Contains(out, secret) {
			t.Errorf("access log contains %q: %s", secret, out)
		}
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(out), &line); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"msg": "http_request", "level": "INFO", "method": "POST", "route": "/api/v1/teams/{teamId}/members",
		"status": float64(201), "request_id": "req-42",
	}
	for k, v := range want {
		if line[k] != v {
			t.Errorf("%s = %v, want %v", k, line[k], v)
		}
	}
	if d, ok := line["duration_ms"].(float64); !ok || d != float64(int64(d)) || strings.Contains(out, `"duration_ms":0.`) {
		t.Errorf("duration_ms = %v, want an integer", line["duration_ms"])
	}
	allowed := map[string]bool{"time": true, "level": true, "msg": true, "method": true, "route": true, "status": true,
		"duration_ms": true, "request_id": true}
	for k := range line {
		if !allowed[k] {
			t.Errorf("unexpected field %q", k)
		}
	}

	if got := testutil.ToFloat64(m.requests.WithLabelValues("/api/v1/teams/{teamId}/members", "POST", "201")); got != 1 {
		t.Errorf("requests counter = %v", got)
	}
}

func TestAccessLogUnmatchedRouteAndImplicitStatus(t *testing.T) {
	var buf bytes.Buffer
	r := chi.NewRouter()
	r.Use(RequestID, Instrument(InstrumentOptions{Logger: slog.New(slog.NewJSONHandler(&buf, nil))}))
	r.Get("/ok", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("x")) })

	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/ok", nil))
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/no/such/%0Apath", nil))
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines: %q", buf.String())
	}
	if !strings.Contains(lines[0], `"route":"/ok","status":200`) {
		t.Errorf("implicit 200: %s", lines[0])
	}
	if !strings.Contains(lines[1], `"route":"unmatched","status":404`) || strings.Contains(lines[1], "no/such") {
		t.Errorf("unmatched: %s", lines[1])
	}
}

func TestMetricsExposeRuntimeAndPrefixedMetrics(t *testing.T) {
	reg := NewRegistry()
	m := NewHTTPMetrics(reg)
	h := Instrument(InstrumentOptions{Metrics: m, Logger: slog.New(slog.NewJSONHandler(io.Discard, nil))})(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/x", nil))

	rec := httptest.NewRecorder()
	Handler(HandlerOptions{Gatherer: reg, Readiness: NewReadiness()}).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, name := range []string{"go_goroutines", "process_cpu_seconds_total",
		"procurement_hub_http_requests_total{", "procurement_hub_http_request_duration_seconds_bucket{"} {
		if !strings.Contains(body, name) {
			t.Errorf("/metrics lacks %s", name)
		}
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("/metrics lacks nosniff")
	}
}
