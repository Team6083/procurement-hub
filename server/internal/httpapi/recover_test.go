package httpapi

import (
	"bufio"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/team6083/procurement-hub/server/internal/ops"
)

// A panicking handler yields 500 internal_error without details, and the
// request still gets its access log line (Recover sits inside Instrument, as
// in app.NewHandler).
func TestRecoverPanic(t *testing.T) {
	var logs strings.Builder
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	r := chi.NewRouter()
	r.Use(ops.RequestID)
	r.Use(ops.Instrument(ops.InstrumentOptions{Logger: logger}))
	r.Use(Recover(logger))
	r.Get("/boom/{id}", func(http.ResponseWriter, *http.Request) { panic("secret detail") })
	r.Get("/err", func(http.ResponseWriter, *http.Request) { panic(errors.New("wrapped secret")) })

	for _, path := range []string{"/boom/1", "/err"} {
		logs.Reset()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Request-ID", "req-123")
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("%s: status = %d", path, rec.Code)
		}
		var body struct {
			Error struct {
				Code    string         `json:"code"`
				Message string         `json:"message"`
				Details map[string]any `json:"details"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: body %q: %v", path, rec.Body.String(), err)
		}
		if body.Error.Code != "internal_error" || len(body.Error.Details) != 0 || strings.Contains(rec.Body.String(), "secret") {
			t.Fatalf("%s: body = %s", path, rec.Body.String())
		}

		var access, panicLine map[string]any
		sc := bufio.NewScanner(strings.NewReader(logs.String()))
		sc.Buffer(nil, 1<<20)
		for sc.Scan() {
			var m map[string]any
			if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
				t.Fatalf("log line %q: %v", sc.Text(), err)
			}
			switch m["msg"] {
			case "http_request":
				access = m
			case "panic in handler":
				panicLine = m
			}
		}
		if access == nil || access["status"] != float64(500) || access["request_id"] != "req-123" {
			t.Fatalf("%s: access log = %v\n%s", path, access, logs.String())
		}
		if panicLine == nil || panicLine["request_id"] != "req-123" || !strings.Contains(panicLine["stack"].(string), "recover_test.go") {
			t.Fatalf("%s: panic log = %v", path, panicLine)
		}
	}
}

// http.ErrAbortHandler keeps its net/http meaning (abort the response).
func TestRecoverRepanicsAbortHandler(t *testing.T) {
	h := Recover(slog.New(slog.DiscardHandler))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Fatalf("recovered %v, want http.ErrAbortHandler", v)
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	t.Fatal("no panic")
}
