package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

type fakeVerifier struct {
	p   *auth.Principal
	err error
}

func (f fakeVerifier) Verify(context.Context, string) (*auth.Principal, error) { return f.p, f.err }

type fakeProv struct{ calls *int }

func (f fakeProv) Provision(context.Context, *auth.Principal) (*domain.User, error) {
	if f.calls != nil {
		*f.calls++
	}
	return &domain.User{Username: "kai"}, nil
}

type fakeML struct{ sawAdmin *bool }

func (f fakeML) ActorFor(_ context.Context, _ *domain.User, admin bool) (authz.Actor, error) {
	*f.sawAdmin = admin
	return authz.Actor{IsSystemAdmin: admin}, nil
}

func TestAuthenticate(t *testing.T) {
	var sawAdmin bool
	var provisioned int
	run := func(header string, v fakeVerifier, allowed ...string) *httptest.ResponseRecorder {
		var called bool
		h := Authenticate(v, allowed, fakeProv{&provisioned}, fakeML{&sawAdmin})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			if CallerFrom(r.Context()) == nil {
				t.Error("caller missing from context")
			}
		}))
		req := httptest.NewRequest("GET", "/x", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == 200 && !called {
			t.Error("handler not called on success")
		}
		return rec
	}

	if rec := run("", fakeVerifier{}); rec.Code != 401 {
		t.Errorf("missing token: %d", rec.Code)
	}
	if rec := run("Basic abc", fakeVerifier{}); rec.Code != 401 {
		t.Errorf("wrong scheme: %d", rec.Code)
	}
	if rec := run("Bearer t", fakeVerifier{err: errors.Join(auth.ErrInvalidToken)}); rec.Code != 401 {
		t.Errorf("invalid token: %d", rec.Code)
	}
	if rec := run("bearer t", fakeVerifier{p: &auth.Principal{Sub: "s", IsSystemAdmin: true}}); rec.Code != 200 || !sawAdmin {
		t.Errorf("valid token: code=%d admin=%v", rec.Code, sawAdmin)
	}

	// ALLOWED_ROLES: the check happens before provisioning.
	provisioned = 0
	plain := fakeVerifier{p: &auth.Principal{Sub: "s", Roles: []string{"staff"}}}
	if rec := run("Bearer t", plain, "procurement-hub-api:user"); rec.Code != 403 || provisioned != 0 {
		t.Errorf("missing role: code=%d provisioned=%d", rec.Code, provisioned)
	} else if !strings.Contains(rec.Body.String(), `"missing_role"`) {
		t.Errorf("missing role body: %s", rec.Body)
	}
	if rec := run("Bearer t", plain, "staff"); rec.Code != 200 || provisioned != 1 {
		t.Errorf("allowed role: code=%d provisioned=%d", rec.Code, provisioned)
	}
	admin := fakeVerifier{p: &auth.Principal{Sub: "s", IsSystemAdmin: true}}
	if rec := run("Bearer t", admin, "staff"); rec.Code != 200 {
		t.Errorf("admin without allowed role: code=%d", rec.Code)
	}
}

var ErrTest = errors.Join(auth.ErrInvalidToken)
