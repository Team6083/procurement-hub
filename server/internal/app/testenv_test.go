package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/config"
	"github.com/team6083/procurement-hub/server/internal/httpapi"
	"github.com/team6083/procurement-hub/server/internal/migrations"
	"github.com/team6083/procurement-hub/server/internal/mongotest"
	"github.com/team6083/procurement-hub/server/internal/service"
	"github.com/team6083/procurement-hub/server/internal/store"
)

const (
	// Keycloak naming (spec §7): the SPA is a public client, and an Audience
	// mapper adds the API audience; roles live on the API client.
	testAudience   = "procurement-hub-api"
	testClientID   = "procurement-hub-web"
	testRoleClient = testAudience
)

// idp is a minimal OIDC provider: discovery document plus a JWKS endpoint,
// signing RS256 tokens with a throwaway key.
type idp struct {
	srv *httptest.Server
	key *rsa.PrivateKey
	kid string
}

func newIDP(t *testing.T) *idp {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &idp{key: key, kid: "test-key-1"}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer": p.srv.URL, "jwks_uri": p.srv.URL + "/jwks",
			"authorization_endpoint": p.srv.URL + "/auth", "token_endpoint": p.srv.URL + "/token",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &key.PublicKey, KeyID: p.kid, Algorithm: "RS256", Use: "sig"},
		}})
	})
	p.srv = httptest.NewServer(mux)
	t.Cleanup(p.srv.Close)
	return p
}

// token signs an access token with the given extra claims. A nil claim value
// removes that claim from the defaults.
func (p *idp) token(t *testing.T, claims map[string]any) string {
	t.Helper()
	return p.tokenWithKey(t, p.key, claims)
}

func (p *idp) tokenWithKey(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	return p.tokenWithAlg(t, jose.RS256, key, claims)
}

// tokenWithAlg signs with an arbitrary algorithm and key, under the IdP's kid.
func (p *idp) tokenWithAlg(t *testing.T, alg jose.SignatureAlgorithm, key any, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: alg, Key: jose.JSONWebKey{Key: key, KeyID: p.kid}},
		(&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	all := map[string]any{
		"iss": p.srv.URL, "aud": testAudience, "azp": testClientID, "typ": "Bearer",
		"iat": now.Unix(), "nbf": now.Add(-time.Minute).Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	}
	for k, v := range claims {
		if v == nil {
			delete(all, k)
			continue
		}
		all[k] = v
	}
	s, err := jwt.Signed(signer).Claims(all).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// env is a running application wired exactly like production, backed by a
// throwaway MongoDB database and the test IDP.
type env struct {
	idp      *idp
	handler  http.Handler
	st       *store.Store
	router   routers.Router
	logs     *syncBuffer // access log output
	verifier *auth.Verifier
}

// syncBuffer is a goroutine-safe log sink.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newEnv(t *testing.T) *env {
	t.Helper()
	return newEnvWith(t, nil)
}

// newEnvWith is newEnv with extra or overridden environment variables.
func newEnvWith(t *testing.T, overrides map[string]string) *env {
	t.Helper()
	return newEnvOpts(t, overrides, false)
}

// newEnvOpts is newEnvWith; undiscovered leaves OIDC discovery unloaded (as
// when the IdP was unreachable at startup) until the test calls
// e.verifier.Discover.
func newEnvOpts(t *testing.T, overrides map[string]string, undiscovered bool) *env {
	t.Helper()
	uri := mongotest.URI(t)
	ctx := context.Background()
	p := newIDP(t)

	vals := map[string]string{
		"CORS_ALLOWED_ORIGINS": "https://app.example.org", "FRONTEND_URL": "https://app.example.org",
		"WEBHOOK_ENCRYPTION_KEY": "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
		"MONGO_URI":              mongotest.WithDatabase(uri, mongotest.DatabaseName("ph_http")),
		"OIDC_ISSUER":            p.srv.URL, "OIDC_AUDIENCE": testAudience,
		// Admins are identified by a *client* role, exercising the oauth2-proxy-style notation.
		"ADMIN_ROLES":          testRoleClient + ":admin",
		"SUPPORTED_CURRENCIES": "USD,TWD,JPY", "BASE_CURRENCY": "USD",
	}
	for k, v := range overrides {
		vals[k] = v
	}
	cfg, err := config.Load(func(k string) string { return vals[k] })
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.DB.Drop(ctx); _ = st.Close(ctx) })
	if _, err := (&migrations.Runner{DB: st.DB, Owner: "test"}).Run(ctx); err != nil {
		t.Fatal(err)
	}

	verifier, err := auth.NewVerifier(auth.VerifierConfig{
		IssuerURL: cfg.OIDCIssuer, Audience: cfg.OIDCAudience, GroupsClaim: cfg.OIDCGroupsClaim,
		AdminRoles: cfg.AdminRoles, ClockSkew: cfg.OIDCClockSkew,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !undiscovered {
		if err := verifier.Discover(ctx); err != nil {
			t.Fatal(err)
		}
	}
	logs := &syncBuffer{}
	h, _ := NewHandler(Deps{
		Config: cfg, Store: st, Verifier: verifier, RoleMappings: service.NewRoleMappings(st),
		Version: httpapi.Version{Version: "test", Commit: "abc123"},
		Logger:  slog.New(slog.NewJSONHandler(logs, nil)),
	})

	doc, err := openapi3.NewLoader().LoadFromFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("load openapi: %v", err)
	}
	if err := doc.Validate(ctx); err != nil {
		t.Fatalf("openapi document is invalid: %v", err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	return &env{idp: p, handler: h, st: st, router: router, logs: logs, verifier: verifier}
}

// user returns a bearer token for a user; admin grants the system-admin client role.
func (e *env) user(t *testing.T, name string, admin bool, groups ...string) string {
	t.Helper()
	claims := map[string]any{
		"sub": "sub-" + name, "preferred_username": name, "email": name + "@example.org", "name": strings.ToUpper(name[:1]) + name[1:],
	}
	if len(groups) > 0 {
		claims["groups"] = groups
	}
	if admin {
		claims["resource_access"] = map[string]any{testRoleClient: map[string]any{"roles": []string{"admin"}}}
	}
	return e.idp.token(t, claims)
}

// result is one HTTP exchange.
type result struct {
	Status int
	Header http.Header
	Body   []byte
	t      *testing.T
}

// JSON decodes the body into a generic map.
func (r *result) JSON() map[string]any {
	r.t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.Body, &m); err != nil {
		r.t.Fatalf("response is not a JSON object (%d): %s", r.Status, r.Body)
	}
	return m
}

func (r *result) String(path ...string) string {
	r.t.Helper()
	var cur any = r.JSON()
	for _, p := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			r.t.Fatalf("path %v: not an object in %s", path, r.Body)
		}
		cur = m[p]
	}
	s, _ := cur.(string)
	return s
}

func (r *result) Items() []any {
	r.t.Helper()
	items, _ := r.JSON()["items"].([]any)
	return items
}

// ETag returns the version from the ETag header as an If-Match value.
func (r *result) ETag() string {
	r.t.Helper()
	v := r.Header.Get("ETag")
	if v == "" {
		r.t.Fatalf("response has no ETag (status %d): %s", r.Status, r.Body)
	}
	return v
}

type call struct {
	token   string
	method  string
	path    string
	body    any
	ifMatch string
	// rawBody sends the bytes as-is (for deliberately malformed requests).
	rawBody []byte
	// skipRequestValidation is for negative tests whose request intentionally
	// violates the schema; the response is still validated.
	skipRequestValidation bool
}

// do sends the request through the real router and validates both the request
// and the response against api/openapi.yaml.
func (e *env) do(t *testing.T, c call) *result {
	t.Helper()
	var payload []byte
	switch {
	case c.rawBody != nil:
		payload = c.rawBody
	case c.body != nil:
		var err error
		if payload, err = json.Marshal(c.body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(c.method, c.path, bytes.NewReader(payload))
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.ifMatch != "" {
		req.Header.Set("If-Match", c.ifMatch)
	}

	ctx := context.Background()
	route, params, err := e.router.FindRoute(req)
	if err != nil {
		t.Fatalf("%s %s is not described by api/openapi.yaml: %v", c.method, c.path, err)
	}
	recordHit(route.Method, route.Path)
	opts := &openapi3filter.Options{AuthenticationFunc: func(context.Context, *openapi3filter.AuthenticationInput) error { return nil }}
	in := &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route, Options: opts}
	if !c.skipRequestValidation {
		if err := openapi3filter.ValidateRequest(ctx, in); err != nil {
			t.Fatalf("request %s %s violates api/openapi.yaml: %v", c.method, c.path, err)
		}
		// ValidateRequest consumes the body; give the handler a fresh copy.
		req.Body = io.NopCloser(bytes.NewReader(payload))
	}

	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	body := rec.Body.Bytes()

	resp := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: in, Status: rec.Code, Header: rec.Header(),
		Options: &openapi3filter.Options{IncludeResponseStatus: true},
	}
	resp.SetBodyBytes(body)
	// Common headers on every response (spec §16.1, §18.2).
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("X-Request-ID") == "" ||
		rec.Header().Get("X-App-Version") == "" {
		t.Fatalf("response to %s %s (status %d) lacks common headers: %v", c.method, c.path, rec.Code, rec.Header())
	}
	if err := openapi3filter.ValidateResponse(ctx, resp); err != nil {
		t.Fatalf("response to %s %s (status %d) violates api/openapi.yaml: %v\nbody: %s", c.method, c.path, rec.Code, err, body)
	}
	return &result{Status: rec.Code, Header: rec.Header(), Body: body, t: t}
}

// expect fails the test unless the status matches (and, for errors, the code).
func (r *result) expect(status int, errCode ...string) *result {
	r.t.Helper()
	if r.Status != status {
		r.t.Fatalf("status = %d, want %d; body: %s", r.Status, status, r.Body)
	}
	if len(errCode) > 0 {
		if got := r.String("error", "code"); got != errCode[0] {
			r.t.Fatalf("error code = %q, want %q; body: %s", got, errCode[0], r.Body)
		}
	}
	return r
}

func itoa(i int) string { return strconv.Itoa(i) }
