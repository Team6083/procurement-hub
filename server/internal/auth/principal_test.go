package auth

import (
	"reflect"
	"testing"
	"time"
)

func TestStringsAtPath(t *testing.T) {
	claims := map[string]any{
		"groups":       []any{"/a", "/b"},
		"realm_access": map[string]any{"roles": []any{"x", 1.0, "y"}},
		"single":       "only",
	}
	tests := []struct {
		path string
		want []string
	}{
		{"groups", []string{"/a", "/b"}},
		{"realm_access.roles", []string{"x", "y"}},
		{"single", []string{"only"}},
		{"missing", nil},
		{"groups.deeper", nil},
		{"realm_access.missing", nil},
	}
	for _, tt := range tests {
		if got := StringsAtPath(claims, tt.path); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("%s: got %v want %v", tt.path, got, tt.want)
		}
	}
}

func TestPrincipalFromClaims(t *testing.T) {
	claims := map[string]any{
		"sub": "u1", "preferred_username": "kai", "email": "k@example.org", "name": "Kai",
		"iat":          1700000000.0,
		"groups":       []any{"/teams/a/members"},
		"realm_access": map[string]any{"roles": []any{"system-admin"}},
	}
	p, err := PrincipalFromClaims(claims, "groups", RoleLists{Admin: []string{"system-admin"}})
	if err != nil {
		t.Fatal(err)
	}
	if !p.IsSystemAdmin || p.Sub != "u1" || len(p.Groups) != 1 || p.IssuedAt.Unix() != 1700000000 {
		t.Fatalf("unexpected principal: %+v", p)
	}
	p, _ = PrincipalFromClaims(claims, "groups", RoleLists{Admin: []string{"other-role"}})
	if p.IsSystemAdmin {
		t.Fatal("admin granted without matching role")
	}
	if _, err := PrincipalFromClaims(map[string]any{}, "groups", RoleLists{Admin: []string{"x"}}); err == nil {
		t.Fatal("expected error for missing sub")
	}
}

func TestCheckTimes(t *testing.T) {
	now := time.Unix(1000, 0)
	skew := 60 * time.Second
	tests := []struct {
		name   string
		claims map[string]any
		ok     bool
	}{
		{"valid", map[string]any{"exp": 2000.0, "nbf": 900.0}, true},
		{"nbf within skew", map[string]any{"exp": 2000.0, "nbf": 1050.0}, true},
		{"nbf beyond skew", map[string]any{"exp": 2000.0, "nbf": 1100.0}, false},
		{"exp within skew", map[string]any{"exp": 950.0}, true},
		{"exp beyond skew", map[string]any{"exp": 900.0}, false},
		{"exp missing", map[string]any{"nbf": 900.0}, false},
	}
	for _, tt := range tests {
		if err := checkTimes(tt.claims, now, skew); (err == nil) != tt.ok {
			t.Errorf("%s: err=%v want ok=%v", tt.name, err, tt.ok)
		}
	}
}

func TestSystemAdminFromRealmOrClientRole(t *testing.T) {
	claims := map[string]any{
		"sub":          "u1",
		"realm_access": map[string]any{"roles": []any{"offline_access", "realm-admin"}},
		"resource_access": map[string]any{
			"procurement-hub-api": map[string]any{"roles": []any{"admin"}},
			"other-app":           map[string]any{"roles": []any{"viewer"}},
		},
	}
	tests := []struct {
		name  string
		admin []string
		want  bool
	}{
		{"realm role", []string{"realm-admin"}, true},
		{"client role", []string{"procurement-hub-api:admin"}, true},
		{"any of several", []string{"nope", "procurement-hub-api:admin"}, true},
		{"client role on the wrong client", []string{"other-app:admin"}, false},
		{"right client, wrong role", []string{"procurement-hub-api:viewer"}, false},
		{"bare name does not match a client role", []string{"admin"}, false},
		{"no match", []string{"system-admin"}, false},
		{"empty list grants nothing", nil, false},
	}
	for _, tt := range tests {
		p, err := PrincipalFromClaims(claims, "groups", RoleLists{Admin: tt.admin})
		if err != nil {
			t.Fatal(err)
		}
		if p.IsSystemAdmin != tt.want {
			t.Errorf("%s: IsSystemAdmin = %v, want %v (roles %v)", tt.name, p.IsSystemAdmin, tt.want, p.Roles)
		}
	}
}

func TestClientRolesNotation(t *testing.T) {
	got := ClientRoles(map[string]any{"resource_access": map[string]any{
		"b": map[string]any{"roles": []any{"r2", "r1"}},
		"a": map[string]any{"roles": []any{"x"}},
		"c": "malformed",
	}})
	want := []string{"a:x", "b:r2", "b:r1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if got := ClientRoles(map[string]any{}); len(got) != 0 {
		t.Fatalf("missing resource_access: %v", got)
	}
}

func TestCheckType(t *testing.T) {
	tests := []struct {
		typ any
		ok  bool
	}{
		{"Bearer", true},
		{"ID", false},
		{"Refresh", false},
		{"bearer", false},
		{nil, false},
		{1.0, false},
	}
	for _, tt := range tests {
		claims := map[string]any{}
		if tt.typ != nil {
			claims["typ"] = tt.typ
		}
		if err := checkType(claims); (err == nil) != tt.ok {
			t.Errorf("typ %v: err=%v want ok=%v", tt.typ, err, tt.ok)
		}
	}
}

func TestSigningAlgs(t *testing.T) {
	if got, err := signingAlgs(nil); err != nil || !reflect.DeepEqual(got, []string{"RS256"}) {
		t.Fatalf("default: %v %v", got, err)
	}
	if got, err := signingAlgs([]string{"ES256", "PS256"}); err != nil || len(got) != 2 {
		t.Fatalf("asymmetric list: %v %v", got, err)
	}
	for _, bad := range []string{"none", "HS256", "HS384", "HS512", "rs256", ""} {
		if _, err := signingAlgs([]string{"RS256", bad}); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestHasAccess(t *testing.T) {
	claims := map[string]any{
		"sub":          "u1",
		"realm_access": map[string]any{"roles": []any{"staff", "odd:name"}},
		"resource_access": map[string]any{
			"procurement-hub-api": map[string]any{"roles": []any{"user"}},
		},
	}
	tests := []struct {
		name    string
		admin   []string
		allowed []string
		want    bool
	}{
		{"unset allows everyone", nil, nil, true},
		{"realm role", nil, []string{"staff"}, true},
		{"client role", nil, []string{"procurement-hub-api:user"}, true},
		{"any of several", nil, []string{"nope", "staff"}, true},
		{"bare name does not match a client role", nil, []string{"user"}, false},
		{"client syntax does not match a realm role", nil, []string{"realm:staff"}, false},
		{"realm role containing a colon is ignored", nil, []string{"odd:name"}, false},
		{"no match", nil, []string{"other"}, false},
		{"system admin always passes", []string{"staff"}, []string{"other"}, true},
	}
	for _, tt := range tests {
		p, err := PrincipalFromClaims(claims, "groups", RoleLists{Admin: tt.admin})
		if err != nil {
			t.Fatal(err)
		}
		if got := p.HasAccess(tt.allowed); got != tt.want {
			t.Errorf("%s: HasAccess = %v, want %v (roles %v)", tt.name, got, tt.want, p.Roles)
		}
	}
}
