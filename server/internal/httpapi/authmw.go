package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

// TokenVerifier verifies a bearer token (implemented by auth.Verifier).
type TokenVerifier interface {
	Verify(ctx context.Context, raw string) (*auth.Principal, error)
}

// Provisioner upserts the user and syncs memberships (service.Identity).
type Provisioner interface {
	Provision(ctx context.Context, p *auth.Principal) (*domain.User, error)
}

// MembershipLoader returns the user's effective role per team.
type MembershipLoader interface {
	ActorFor(ctx context.Context, u *domain.User, isSystemAdmin bool) (authz.Actor, error)
}

type reqCtxKey struct{}

// Caller is the authenticated request context.
type Caller struct {
	User  *domain.User
	Actor authz.Actor
}

func CallerFrom(ctx context.Context) *Caller {
	c, _ := ctx.Value(reqCtxKey{}).(*Caller)
	return c
}

// Authenticate requires a valid bearer token on every request that reaches it.
// System admin status is read from the current token on each request (§7.3).
// When allowedRoles (ALLOWED_ROLES) is non-empty, callers that are neither a
// system admin nor hold one of those roles get 403 missing_role before any
// user record is created or role mappings are synced.
func Authenticate(v TokenVerifier, allowedRoles []string, prov Provisioner, ml MembershipLoader) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearer(r)
			if !ok {
				WriteError(w, NewError(http.StatusUnauthorized, "unauthenticated", "Missing bearer token."))
				return
			}
			p, err := v.Verify(r.Context(), raw)
			if err != nil {
				if !errors.Is(err, auth.ErrInvalidToken) {
					slog.ErrorContext(r.Context(), "token verification failed", "error", err)
				}
				WriteError(w, NewError(http.StatusUnauthorized, "unauthenticated", "Invalid or expired token."))
				return
			}
			if !p.HasAccess(allowedRoles) {
				WriteError(w, NewError(http.StatusForbidden, "missing_role", "You do not have access to this service."))
				return
			}
			u, err := prov.Provision(r.Context(), p)
			if err != nil {
				slog.ErrorContext(r.Context(), "provisioning failed", "error", err)
				WriteError(w, NewError(http.StatusInternalServerError, "internal_error", "Internal error."))
				return
			}
			actor, err := ml.ActorFor(r.Context(), u, p.IsSystemAdmin)
			if err != nil {
				slog.ErrorContext(r.Context(), "loading memberships failed", "error", err)
				WriteError(w, NewError(http.StatusInternalServerError, "internal_error", "Internal error."))
				return
			}
			ctx := context.WithValue(r.Context(), reqCtxKey{}, &Caller{User: u, Actor: actor})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearer(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	const prefix = "bearer "
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", false
	}
	return strings.TrimSpace(h[len(prefix):]), true
}
