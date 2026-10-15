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
	p, err := PrincipalFromClaims(claims, "groups", "realm_access.roles", "system-admin")
	if err != nil {
		t.Fatal(err)
	}
	if !p.IsSystemAdmin || p.Sub != "u1" || len(p.Groups) != 1 || p.IssuedAt.Unix() != 1700000000 {
		t.Fatalf("unexpected principal: %+v", p)
	}
	p, _ = PrincipalFromClaims(claims, "groups", "realm_access.roles", "other-role")
	if p.IsSystemAdmin {
		t.Fatal("admin granted without matching role")
	}
	if _, err := PrincipalFromClaims(map[string]any{}, "groups", "roles", "x"); err == nil {
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
		{"nbf within skew", map[string]any{"nbf": 1050.0}, true},
		{"nbf beyond skew", map[string]any{"nbf": 1100.0}, false},
		{"exp within skew", map[string]any{"exp": 950.0}, true},
		{"exp beyond skew", map[string]any{"exp": 900.0}, false},
	}
	for _, tt := range tests {
		if err := checkTimes(tt.claims, now, skew); (err == nil) != tt.ok {
			t.Errorf("%s: err=%v want ok=%v", tt.name, err, tt.ok)
		}
	}
}
