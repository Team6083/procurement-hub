package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// Spec §18.2: an unreachable IdP at startup does not stop serve. /readyz
// stays 503 (check "oidc") and authenticated requests get 503
// upstream_unavailable while discovery is retried in the background; once
// the IdP comes up, serve turns ready and tokens are accepted.
func TestServeRetriesOIDCDiscovery(t *testing.T) {
	mongoURI, _ := scratchDB(t)
	var out bytes.Buffer
	t.Setenv("MONGO_URI", mongoURI)
	if c := run([]string{"migrate"}, &out, &out); c != 0 {
		t.Fatalf("migrate exit %d: %s", c, out.String())
	}

	idpAddr := freeAddr(t) // nothing listens here yet
	issuer := "http://" + idpAddr
	apiAddr, opsAddr := freeAddr(t), freeAddr(t)
	setServeEnv(t, mongoURI, issuer, map[string]string{
		"LISTEN_ADDR": apiAddr, "METRICS_LISTEN_ADDR": opsAddr, "SHUTDOWN_TIMEOUT": "5s",
	})
	done := make(chan int, 1)
	go func() { done <- run([]string{"serve"}, &bytes.Buffer{}, &bytes.Buffer{}) }()
	defer func() {
		_ = syscall.Kill(os.Getpid(), syscall.SIGTERM)
		select {
		case c := <-done:
			if c != 0 {
				t.Errorf("serve exit %d after SIGTERM", c)
			}
		case <-time.After(15 * time.Second):
			t.Error("serve did not stop")
		}
	}()

	get := func(url, token string) (int, string) {
		req, _ := http.NewRequest("GET", url, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return 0, err.Error()
		}
		defer func() { _ = resp.Body.Close() }()
		var b bytes.Buffer
		_, _ = b.ReadFrom(resp.Body)
		return resp.StatusCode, b.String()
	}
	waitFor := func(what string, cond func() bool) {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for !cond() {
			if time.Now().After(deadline) {
				t.Fatalf("timed out waiting for %s", what)
			}
			select {
			case c := <-done:
				done <- c
				t.Fatalf("serve exited with %d while waiting for %s", c, what)
			case <-time.After(50 * time.Millisecond):
			}
		}
	}

	readyz := "http://" + opsAddr + "/readyz"
	waitFor("ops server", func() bool { c, _ := get(readyz, ""); return c != 0 })
	if code, body := get(readyz, ""); code != http.StatusServiceUnavailable || !strings.Contains(body, `"check":"oidc"`) {
		t.Fatalf("before IdP: readyz %d %s, want 503 naming oidc", code, body)
	}
	if code, body := get("http://"+apiAddr+"/api/v1/me", "not-yet-verifiable"); code != http.StatusServiceUnavailable ||
		!strings.Contains(body, `"upstream_unavailable"`) {
		t.Fatalf("before IdP: /me %d %s, want 503 upstream_unavailable", code, body)
	}

	// Bring the IdP up on the configured address.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", idpAddr)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "jwks_uri": issuer + "/jwks"})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
		}})
	})
	idp := httptest.NewUnstartedServer(mux)
	_ = idp.Listener.Close()
	idp.Listener = ln
	idp.Start()
	defer idp.Close()

	waitFor("readyz 200", func() bool { c, _ := get(readyz, ""); return c == http.StatusOK })

	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "k1"}},
		(&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	tok, err := jwt.Signed(signer).Claims(map[string]any{
		"iss": issuer, "aud": "procurement-hub-api", "typ": "Bearer", "sub": "sub-late",
		"preferred_username": "late", "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	}).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	if code, body := get("http://"+apiAddr+"/api/v1/me", tok); code != http.StatusOK {
		t.Fatalf("after IdP: /me %d %s, want 200", code, body)
	}
}
