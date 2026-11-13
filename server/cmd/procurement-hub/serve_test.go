package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/migrations"
	"github.com/team6083/procurement-hub/server/internal/mongotest"
	"github.com/team6083/procurement-hub/server/internal/store"
)

func TestMain(m *testing.M) { os.Exit(mongotest.Main(m)) }

// fakeIDP serves just enough OIDC discovery for serve to start.
func fakeIDP(t *testing.T) string {
	t.Helper()
	var issuer string
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "jwks_uri": issuer + "/jwks"})
	}))
	t.Cleanup(idp.Close)
	issuer = idp.URL
	return issuer
}

// scratchDB returns a MONGO_URI for a fresh database that is dropped after
// the test, and a store connected to it.
func scratchDB(t *testing.T) (string, *store.Store) {
	t.Helper()
	st := mongotest.EmptyStore(t, "ph_main")
	return mongotest.WithDatabase(mongotest.URI(t), st.DB.Name()), st
}

func setServeEnv(t *testing.T, mongoURI, issuer string, extra map[string]string) {
	t.Helper()
	vals := map[string]string{
		"METRICS_LISTEN_ADDR":  "off",
		"CORS_ALLOWED_ORIGINS": "https://app.example.org", "FRONTEND_URL": "https://app.example.org",
		"MONGO_URI": mongoURI, "OIDC_ISSUER": issuer, "OIDC_AUDIENCE": "procurement-hub-api",
		"ADMIN_ROLES": "admin", "WEBHOOK_ENCRYPTION_KEY": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
		"LOG_LEVEL": "error",
	}
	for k, v := range extra {
		vals[k] = v
	}
	for k, v := range vals {
		t.Setenv(k, v)
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

// Spec §18.2: any startup error, including a port already in use, exits 1.
// This runs the real serve path (MongoDB, OIDC discovery) up to the bind.
func TestServePortInUseExitsOne(t *testing.T) {
	issuer := fakeIDP(t)
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = busy.Close() }()
	mongoURI, _ := scratchDB(t)
	setServeEnv(t, mongoURI, issuer, map[string]string{"LISTEN_ADDR": busy.Addr().String()})
	var stdout, stderr bytes.Buffer
	if code := run([]string{"serve"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
}

// migrate applies every registered migration (exit 0) and a second run is a
// no-op (exit 0).
func TestMigrateCommand(t *testing.T) {
	mongoURI, _ := scratchDB(t)
	t.Setenv("MONGO_URI", mongoURI)
	t.Setenv("LOG_LEVEL", "info")
	var out, errOut bytes.Buffer
	if code := run([]string{"migrate"}, &out, &errOut); code != 0 {
		t.Fatalf("first migrate: exit %d\n%s%s", code, out.String(), errOut.String())
	}
	for _, m := range migrations.All() {
		if !strings.Contains(out.String(), `"msg":"applied migration","migration":"`+m.ID+`"`) {
			t.Errorf("first run did not log applying %s:\n%s", m.ID, out.String())
		}
	}
	out.Reset()
	if code := run([]string{"migrate"}, &out, &errOut); code != 0 {
		t.Fatalf("second migrate: exit %d\n%s%s", code, out.String(), errOut.String())
	}
	if strings.Contains(out.String(), "applied migration") || !strings.Contains(out.String(), `"applied":0`) {
		t.Errorf("second run was not a no-op:\n%s", out.String())
	}
}

func TestMigrateFailureNamesMigration(t *testing.T) {
	mongoURI, st := scratchDB(t)
	// A rate that is not a decimal makes 0001's conversion fail.
	if _, err := st.DB.Collection("teams").InsertOne(context.Background(), bson.D{{Key: "slug", Value: "bad"},
		{Key: "referenceRates", Value: bson.A{bson.D{{Key: "currency", Value: "TWD"}, {Key: "rateToBase", Value: "abc"}}}}}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MONGO_URI", mongoURI)
	t.Setenv("LOG_LEVEL", "info")
	var out, errOut bytes.Buffer
	if code := run([]string{"migrate"}, &out, &errOut); code != 1 {
		t.Fatalf("exit %d, want 1\n%s", code, out.String())
	}
	if !strings.Contains(out.String(), "migration 0001_reference_rates_decimal failed") {
		t.Errorf("output does not name the failed migration:\n%s", out.String())
	}
	if n, _ := st.DB.Collection("migrations").CountDocuments(context.Background(), bson.D{}); n != 0 {
		t.Errorf("failed migration recorded (%d records)", n)
	}
}

// Acceptance criterion 9 (spec §21): serve started before migrate stays
// unready (503, check "migrations"); after migrate it turns ready without a
// restart. serve itself creates no indexes.
func TestServeReadyOnlyAfterMigrate(t *testing.T) {
	mongoURI, st := scratchDB(t)
	opsAddr := freeAddr(t)
	setServeEnv(t, mongoURI, fakeIDP(t), map[string]string{
		"LISTEN_ADDR": freeAddr(t), "METRICS_LISTEN_ADDR": opsAddr, "SHUTDOWN_TIMEOUT": "5s",
	})
	done := make(chan int, 1)
	go func() { done <- run([]string{"serve"}, &bytes.Buffer{}, &bytes.Buffer{}) }()
	stopped := false
	defer func() {
		if !stopped {
			_ = syscall.Kill(os.Getpid(), syscall.SIGTERM)
			<-done
		}
	}()

	probe := func() (int, string) {
		resp, err := http.Get("http://" + opsAddr + "/readyz")
		if err != nil {
			return 0, err.Error()
		}
		defer func() { _ = resp.Body.Close() }()
		var b bytes.Buffer
		_, _ = b.ReadFrom(resp.Body)
		return resp.StatusCode, b.String()
	}
	deadline := time.Now().Add(20 * time.Second)
	code, body := probe()
	for code == 0 && time.Now().Before(deadline) {
		select {
		case c := <-done:
			stopped = true
			t.Fatalf("serve exited early with %d", c)
		case <-time.After(50 * time.Millisecond):
		}
		code, body = probe()
	}
	if code != http.StatusServiceUnavailable || !strings.Contains(body, `"check":"migrations"`) {
		t.Fatalf("before migrate: %d %s, want 503 naming migrations", code, body)
	}

	// serve did not create indexes (only the migration does).
	if specs, err := st.DB.Collection("users").Indexes().ListSpecifications(context.Background()); err == nil && len(specs) > 0 {
		t.Fatalf("serve created indexes on users: %v", specs)
	}

	var out bytes.Buffer
	if c := run([]string{"migrate"}, &out, &out); c != 0 {
		t.Fatalf("migrate exit %d: %s", c, out.String())
	}
	if code, body := probe(); code != http.StatusOK {
		t.Fatalf("after migrate: %d %s, want 200", code, body)
	}

	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	stopped = true
	select {
	case c := <-done:
		if c != 0 {
			t.Fatalf("serve exit %d after SIGTERM", c)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("serve did not stop")
	}
}
