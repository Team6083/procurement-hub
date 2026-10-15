// Package auth verifies bearer tokens and builds the request principal (spec §7).
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

// PrincipalFromClaims builds a Principal from decoded claims.
func PrincipalFromClaims(claims map[string]any, groupsClaim, rolesClaim, adminRole string) (*Principal, error) {
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
		Roles:             StringsAtPath(claims, rolesClaim),
	}
	if iat, ok := claims["iat"].(float64); ok {
		p.IssuedAt = time.Unix(int64(iat), 0).UTC()
	}
	for _, r := range p.Roles {
		if r == adminRole {
			p.IsSystemAdmin = true
		}
	}
	return p, nil
}

// VerifierConfig mirrors the OIDC_* settings.
type VerifierConfig struct {
	IssuerURL   string
	Audience    string
	GroupsClaim string
	RolesClaim  string
	AdminRole   string
	ClockSkew   time.Duration
}

// Verifier validates access tokens against the issuer's JWKS.
type Verifier struct {
	cfg VerifierConfig
	v   *oidc.IDTokenVerifier
	now func() time.Time
}

// NewVerifier performs OIDC discovery (failing fast if unreachable).
func NewVerifier(ctx context.Context, cfg VerifierConfig) (*Verifier, error) {
	prov, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}
	return newVerifier(cfg, prov.Verifier(&oidc.Config{
		SkipClientIDCheck:    true, // audience is checked manually
		SupportedSigningAlgs: []string{"RS256", "ES256", "PS256"},
		// go-oidc has no skew option; shifting its clock back tolerates
		// slightly expired tokens by the configured skew.
		Now: func() time.Time { return time.Now().Add(-cfg.ClockSkew) },
	})), nil
}

func newVerifier(cfg VerifierConfig, v *oidc.IDTokenVerifier) *Verifier {
	return &Verifier{cfg: cfg, v: v, now: time.Now}
}

var ErrInvalidToken = errors.New("invalid token")

// Verify checks signature, iss, exp, nbf (with clock skew), aud and sub.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Principal, error) {
	tok, err := v.v.Verify(ctx, raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	var claims map[string]any
	if err := tok.Claims(&claims); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	if err := checkTimes(claims, v.now(), v.cfg.ClockSkew); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	if !hasAudience(tok.Audience, v.cfg.Audience) {
		return nil, fmt.Errorf("%w: audience mismatch", ErrInvalidToken)
	}
	p, err := PrincipalFromClaims(claims, v.cfg.GroupsClaim, v.cfg.RolesClaim, v.cfg.AdminRole)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
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

// checkTimes enforces nbf with skew; exp is enforced by go-oidc (without
// skew), so we additionally re-check it here with skew applied.
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
	if exp, ok := num("exp"); ok && now.Add(-skew).After(exp) {
		return errors.New("token expired")
	}
	return nil
}
