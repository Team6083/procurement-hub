package ops

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
)

func TestHealthAndReadiness(t *testing.T) {
	var logs bytes.Buffer
	ready := NewReadiness()
	var mongoErr, migrationsErr error
	var order []string
	ready.Add("mongodb", func(context.Context) error { order = append(order, "mongodb"); return mongoErr })
	ready.Add("oidc", func(context.Context) error { order = append(order, "oidc"); return nil })
	// The extension point for step-by-step additions such as migrations.
	ready.Add("migrations", func(context.Context) error { order = append(order, "migrations"); return migrationsErr })
	h := Handler(HandlerOptions{Gatherer: prometheus.NewRegistry(), Readiness: ready,
		Logger: slog.New(slog.NewJSONHandler(&logs, nil))})

	get := func(path string) (int, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s lacks nosniff", path)
		}
		if rec.Header().Get(RequestIDHeader) == "" {
			t.Errorf("%s lacks X-Request-ID", path)
		}
		return rec.Code, strings.TrimSpace(rec.Body.String())
	}

	if c, b := get("/healthz"); c != 200 || b != `{"status":"ok"}` {
		t.Fatalf("healthz: %d %s", c, b)
	}
	if c, b := get("/readyz"); c != 200 || b != `{"status":"ready"}` {
		t.Fatalf("readyz: %d %s", c, b)
	}
	if strings.Join(order, ",") != "mongodb,oidc,migrations" {
		t.Errorf("check order: %v", order)
	}
	if logs.Len() != 0 {
		t.Errorf("successful probes were logged: %s", logs.String())
	}

	migrationsErr = errors.New("2 pending (secret detail)")
	if c, b := get("/readyz"); c != 503 || b != `{"check":"migrations","status":"not_ready"}` {
		t.Fatalf("readyz with pending migrations: %d %s", c, b)
	}
	if !strings.Contains(logs.String(), `"msg":"http_request"`) || !strings.Contains(logs.String(), `"route":"GET /readyz"`) ||
		!strings.Contains(logs.String(), `"msg":"not ready"`) {
		t.Errorf("failed probe not logged: %s", logs.String())
	}

	migrationsErr, mongoErr = nil, errors.New("no primary")
	if c, b := get("/readyz"); c != 503 || !strings.Contains(b, `"check":"mongodb"`) {
		t.Fatalf("readyz without primary: %d %s", c, b)
	}

	mongoErr = nil
	ready.Drain()
	if c, b := get("/readyz"); c != 503 || !strings.Contains(b, `"check":"shutdown"`) {
		t.Fatalf("readyz while draining: %d %s", c, b)
	}
	if c, _ := get("/healthz"); c != 200 {
		t.Fatalf("healthz while draining: %d", c)
	}
}
