package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/team6083/procurement-hub/server/internal/store"
)

// Spec §18.2: any startup error, including a port already in use, exits 1.
// This runs the real serve path (MongoDB, OIDC discovery) up to the bind.
func TestServePortInUseExitsOne(t *testing.T) {
	uri := os.Getenv("TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("TEST_MONGODB_URI not set")
	}
	var issuer string
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "jwks_uri": issuer + "/jwks"})
	}))
	defer idp.Close()
	issuer = idp.URL

	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = busy.Close() }()

	db := fmt.Sprintf("ph_main_%d", time.Now().UnixNano())
	base, query, _ := strings.Cut(uri, "?")
	scheme, rest, _ := strings.Cut(base, "://")
	hosts, _, _ := strings.Cut(rest, "/")
	mongoURI := scheme + "://" + hosts + "/" + db + "?" + query
	defer func() {
		if st, err := store.Connect(context.Background(), mongoURI, db); err == nil {
			_ = st.DB.Drop(context.Background())
			_ = st.Close(context.Background())
		}
	}()

	for k, v := range map[string]string{
		"LISTEN_ADDR": busy.Addr().String(), "METRICS_LISTEN_ADDR": "off",
		"CORS_ALLOWED_ORIGINS": "https://app.example.org", "FRONTEND_URL": "https://app.example.org",
		"MONGO_URI": mongoURI, "OIDC_ISSUER": issuer, "OIDC_AUDIENCE": "procurement-hub-api",
		"ADMIN_ROLES": "admin", "WEBHOOK_ENCRYPTION_KEY": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
		"LOG_LEVEL": "error",
	} {
		t.Setenv(k, v)
	}
	var stdout, stderr bytes.Buffer
	if code := run([]string{"serve"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
}
