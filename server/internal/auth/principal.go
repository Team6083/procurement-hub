// Package auth verifies bearer tokens and builds the request principal (spec §7).
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Principal is the authenticated caller, derived from a verified access token.
type Principal struct {
	Sub               string
	PreferredUsername string
	Email             string
	Name              string
	Groups            []string
	Roles             []string
	IssuedAt          time.Time
	IsSystemAdmin     bool
}

type ctxKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

func FromContext(ctx context.Context) (*Principal, bool) {
	p, ok := ctx.Value(ctxKey{}).(*Principal)
	return p, ok
}

// StringsAtPath walks a dot path (e.g. "realm_access.roles") in decoded JSON
// claims and returns the string list found there. Missing paths yield nil.
// A bare string value is returned as a one-element list.
func StringsAtPath(claims map[string]any, path string) []string {
	var cur any = claims
	for _, part := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		if cur, ok = m[part]; !ok {
			return nil
		}
	}
	switch v := cur.(type) {
	case string:
		return []string{v}
	case []any:
		out := make([]string, 0, len(v))
		for _, e := range v {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// ClientRoles reads Keycloak client roles from resource_access and returns
// them as "<client id>:<role>", the same notation oauth2-proxy's
// --allowed-role uses. Realm roles stay as bare names.
func ClientRoles(claims map[string]any) []string {
	ra, _ := claims["resource_access"].(map[string]any)
	clients := make([]string, 0, len(ra))
	for c := range ra {
		clients = append(clients, c)
	}
	sort.Strings(clients) // deterministic order
	var out []string
	for _, c := range clients {
		m, _ := ra[c].(map[string]any)
		for _, r := range StringsAtPath(m, "roles") {
			out = append(out, c+":"+r)
		}
	}
	return out
}

// PrincipalFromClaims builds a Principal from decoded claims. Roles holds the
// realm roles (bare names, from realm_access.roles) followed by client roles
// ("<client id>:<role>", spec §7.3). The principal is a system admin if any
// adminRoles entry is among them.
func PrincipalFromClaims(claims map[string]any, groupsClaim string, adminRoles []string) (*Principal, error) {
	str := func(k string) string { s, _ := claims[k].(string); return s }
	sub := str("sub")
	if sub == "" {
		return nil, errors.New("token has no sub")
	}
	p := &Principal{
		Sub:               sub,
		PreferredUsername: str("preferred_username"),
		Email:             str("email"),
		Name:              str("name"),
		Groups:            StringsAtPath(claims, groupsClaim),
		Roles:             append(realmRoles(claims), ClientRoles(claims)...),
	}
	if iat, ok := claims["iat"].(float64); ok {
		p.IssuedAt = time.Unix(int64(iat), 0).UTC()
	}
	p.IsSystemAdmin = HasAnyRole(p.Roles, adminRoles)
	return p, nil
}

// realmRoles returns realm_access.roles. Names containing ":" are dropped:
// that notation is reserved for client roles (spec §7.3), so such a realm
// role could otherwise be mistaken for "<client id>:<role>".
func realmRoles(claims map[string]any) []string {
	var out []string
	for _, r := range StringsAtPath(claims, "realm_access.roles") {
		if !strings.Contains(r, ":") {
			out = append(out, r)
		}
	}
	return out
}

// HasAnyRole reports whether roles (as built by PrincipalFromClaims) match any
// entry of an ADMIN_ROLES / ALLOWED_ROLES list. An entry without ":" matches
// a realm role; "<client id>:<role>" matches that client's role. Because
// realm roles never contain ":", plain equality keeps the two kinds apart.
func HasAnyRole(roles, entries []string) bool {
	for _, e := range entries {
		for _, r := range roles {
			if r == e {
				return true
			}
		}
	}
	return false
}

// HasAccess reports whether the principal may use the service at all
// (ALLOWED_ROLES, spec §7.3): an empty list means unrestricted; otherwise a
// system admin or anyone holding one of the allowed roles passes.
func (p *Principal) HasAccess(allowedRoles []string) bool {
	return len(allowedRoles) == 0 || p.IsSystemAdmin || HasAnyRole(p.Roles, allowedRoles)
}

// VerifierConfig mirrors the OIDC_* and ADMIN_ROLES settings.
type VerifierConfig struct {
	IssuerURL   string
	Audience    string
	GroupsClaim string
	AdminRoles  []string // realm role, or "<client id>:<client role>"; any match grants system admin
	ClockSkew   time.Duration
	// SigningAlgs is the signature algorithm allowlist; empty means
	// DefaultSigningAlgs. The token header never widens it (spec §7.2).
	SigningAlgs []string
}

// DefaultSigningAlgs is what Keycloak realms sign access tokens with by default.
var DefaultSigningAlgs = []string{"RS256"}

// asymmetricAlgs are the JWS algorithms a verifier may be configured with.
// "none" and the HS* (shared-secret) family are deliberately absent.
var asymmetricAlgs = map[string]bool{
	"RS256": true, "RS384": true, "RS512": true,
	"PS256": true, "PS384": true, "PS512": true,
	"ES256": true, "ES384": true, "ES512": true,
	"EdDSA": true,
}

// signingAlgs returns the effective allowlist, rejecting anything that is not
// an asymmetric signature algorithm.
func signingAlgs(cfg []string) ([]string, error) {
	if len(cfg) == 0 {
		return DefaultSigningAlgs, nil
	}
	for _, a := range cfg {
		if !asymmetricAlgs[a] {
			return nil, fmt.Errorf("signing algorithm %q is not an allowed asymmetric algorithm", a)
		}
	}
	return cfg, nil
}

// Verifier validates access tokens against the issuer's JWKS. It is created
// before OIDC discovery has succeeded: until Discover (or Run) loads the
// discovery document, Verify returns ErrNotReady and Ready fails, so an
// unreachable IdP makes the service unready rather than stopping it
// (spec §18.2).
type Verifier struct {
	cfg  VerifierConfig
	algs []string
	v    atomic.Pointer[oidc.IDTokenVerifier]
	now  func() time.Time
}

// NewVerifier validates the configuration; it does not contact the issuer.
func NewVerifier(cfg VerifierConfig) (*Verifier, error) {
	algs, err := signingAlgs(cfg.SigningAlgs)
	if err != nil {
		return nil, err
	}
	return &Verifier{cfg: cfg, algs: algs, now: time.Now}, nil
}

// Discover performs OIDC discovery once. On success the verifier is ready;
// a later call is a no-op.
func (v *Verifier) Discover(ctx context.Context) error {
	if v.v.Load() != nil {
		return nil
	}
	prov, err := oidc.NewProvider(ctx, v.cfg.IssuerURL) // also checks the discovered issuer matches exactly
	if err != nil {
		return fmt.Errorf("oidc discovery: %w", err)
	}
	v.v.Store(prov.Verifier(&oidc.Config{
		SkipClientIDCheck: true, // audience is checked manually
		// A fixed allowlist: go-jose rejects any token whose header alg is
		// not listed, so "none" and HS* never reach signature verification.
		SupportedSigningAlgs: v.algs,
		// go-oidc has no skew option (and a fixed 5-minute nbf leeway), so
		// exp and nbf are checked by checkTimes with OIDC_CLOCK_SKEW instead.
		SkipExpiryCheck: true,
	}))
	return nil
}

// Discovery retry backoff: doubles from the first delay up to the cap.
const (
	discoveryAttemptTimeout = 10 * time.Second
	discoveryFirstBackoff   = time.Second
	discoveryMaxBackoff     = 30 * time.Second
)

// Run retries Discover with exponential backoff until it succeeds or ctx is
// cancelled. It is meant to run in the background for the life of serve.
func (v *Verifier) Run(ctx context.Context) {
	delay := discoveryFirstBackoff
	for {
		actx, cancel := context.WithTimeout(ctx, discoveryAttemptTimeout)
		err := v.Discover(actx)
		cancel()
		if err == nil {
			slog.Info("oidc discovery loaded", "issuer", v.cfg.IssuerURL)
			return
		}
		if ctx.Err() != nil {
			return
		}
		slog.Warn("oidc discovery failed; retrying", "issuer", v.cfg.IssuerURL, "retry_in", delay.String(), "error", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(delay*2, discoveryMaxBackoff)
	}
}

// ErrNotReady is returned by Verify while OIDC discovery has not loaded.
var ErrNotReady = errors.New("oidc discovery not loaded")

var ErrInvalidToken = errors.New("invalid token")

// Verify checks signature (alg allowlist), iss, exp, nbf (with clock skew),
// aud, typ and sub.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Principal, error) {
	iv := v.v.Load()
	if iv == nil {
		return nil, ErrNotReady
	}
	tok, err := iv.Verify(ctx, raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	var claims map[string]any
	if err := tok.Claims(&claims); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	if err := checkTimes(claims, v.now(), v.cfg.ClockSkew); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	if !hasAudience(tok.Audience, v.cfg.Audience) {
		return nil, fmt.Errorf("%w: audience mismatch", ErrInvalidToken)
	}
	if err := checkType(claims); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	p, err := PrincipalFromClaims(claims, v.cfg.GroupsClaim, v.cfg.AdminRoles)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	return p, nil
}

func hasAudience(aud []string, want string) bool {
	for _, a := range aud {
		if a == want {
			return true
		}
	}
	return false
}

// checkType requires Keycloak's typ claim to be "Bearer" (an access token),
// rejecting ID ("ID"), refresh ("Refresh") and untyped tokens.
func checkType(claims map[string]any) error {
	if typ, _ := claims["typ"].(string); typ != "Bearer" {
		return fmt.Errorf("token typ %q is not Bearer", typ)
	}
	return nil
}

// checkTimes requires exp and enforces exp and nbf with the configured skew.
func checkTimes(claims map[string]any, now time.Time, skew time.Duration) error {
	num := func(k string) (time.Time, bool) {
		switch f := claims[k].(type) {
		case float64:
			return time.Unix(int64(f), 0), true
		case json.Number:
			n, err := f.Int64()
			return time.Unix(n, 0), err == nil
		}
		return time.Time{}, false
	}
	if nbf, ok := num("nbf"); ok && now.Add(skew).Before(nbf) {
		return errors.New("token not yet valid")
	}
	exp, ok := num("exp")
	if !ok {
		return errors.New("token has no exp")
	}
	if now.Add(-skew).After(exp) {
		return errors.New("token expired")
	}
	return nil
}

// Ready is a readiness check: it fails until OIDC discovery has loaded.
func (v *Verifier) Ready(context.Context) error {
	if v == nil || v.v.Load() == nil {
		return ErrNotReady
	}
	return nil
}
