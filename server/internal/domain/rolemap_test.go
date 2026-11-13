package domain

import (
	"reflect"
	"testing"
)

func TestMatch(t *testing.T) {
	m := RoleMapping{Claim: ClaimGroups, Pattern: "/teams/*/members", Team: "$1", Role: RoleMember, Enabled: true}
	tests := []struct {
		value string
		team  string
		ok    bool
	}{
		{"/teams/alpha/members", "alpha", true},
		{"/teams/alpha/admins", "", false},
		{"/teams/alpha/sub/members", "", false},
		{"/teams//members", "", false},
		{"teams/alpha/members", "", false},
	}
	for _, tt := range tests {
		team, ok := m.Match(tt.value)
		if team != tt.team || ok != tt.ok {
			t.Errorf("Match(%q) = %q,%v want %q,%v", tt.value, team, ok, tt.team, tt.ok)
		}
	}
}

func TestMatchMultipleCaptures(t *testing.T) {
	m := RoleMapping{Pattern: "/org/*/team/*", Team: "$2-$1"}
	team, ok := m.Match("/org/x/team/y")
	if !ok || team != "y-x" {
		t.Fatalf("got %q,%v", team, ok)
	}
}

func TestValidate(t *testing.T) {
	base := RoleMapping{Claim: ClaimGroups, Pattern: "/teams/*/members", Team: "$1", Role: RoleMember}
	tests := []struct {
		name   string
		mutate func(*RoleMapping)
		ok     bool
	}{
		{"valid", func(*RoleMapping) {}, true},
		{"fixed team", func(m *RoleMapping) { m.Pattern = "/ops"; m.Team = "ops" }, true},
		{"bad claim", func(m *RoleMapping) { m.Claim = "x" }, false},
		{"bad role", func(m *RoleMapping) { m.Role = "owner" }, false},
		{"partial wildcard", func(m *RoleMapping) { m.Pattern = "/teams/a*/members" }, false},
		{"capture out of range", func(m *RoleMapping) { m.Team = "$2" }, false},
		{"capture without wildcard", func(m *RoleMapping) { m.Pattern = "/ops" }, false},
		{"empty pattern", func(m *RoleMapping) { m.Pattern = "" }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := base
			tt.mutate(&m)
			if err := m.Validate(); (err == nil) != tt.ok {
				t.Fatalf("Validate() = %v, want ok=%v", err, tt.ok)
			}
		})
	}
}

func TestDesiredSSORoles(t *testing.T) {
	rules := []RoleMapping{
		{ID: "m", Claim: ClaimGroups, Pattern: "/teams/*/members", Team: "$1", Role: RoleMember, Enabled: true},
		{ID: "a", Claim: ClaimGroups, Pattern: "/teams/*/admins", Team: "$1", Role: RoleAdmin, Enabled: true},
		{ID: "off", Claim: ClaimGroups, Pattern: "/teams/*/other", Team: "$1", Role: RoleAdmin, Enabled: false},
		{ID: "r", Claim: ClaimRoles, Pattern: "buyer", Team: "ops", Role: RoleMember, Enabled: true},
	}
	got := DesiredSSORoles(rules,
		[]string{"/teams/a/members", "/teams/a/admins", "/teams/b/members", "/teams/c/other"},
		[]string{"buyer"})
	want := map[string]Role{"a": RoleAdmin, "b": RoleMember, "ops": RoleMember}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestEffectiveRole(t *testing.T) {
	tests := []struct{ sso, manual, want Role }{
		{RoleNone, RoleNone, RoleNone},
		{RoleMember, RoleNone, RoleMember},
		{RoleNone, RoleAdmin, RoleAdmin},
		{RoleMember, RoleAdmin, RoleAdmin},
		{RoleAdmin, RoleMember, RoleAdmin},
	}
	for _, tt := range tests {
		if got := EffectiveRole(tt.sso, tt.manual); got != tt.want {
			t.Errorf("EffectiveRole(%q,%q)=%q want %q", tt.sso, tt.manual, got, tt.want)
		}
	}
}
