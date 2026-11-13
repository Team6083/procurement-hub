package domain

import (
	"errors"
	"fmt"
	"strings"
)

type Role string

const (
	RoleNone   Role = ""
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
)

func (r Role) Valid() bool { return r == RoleMember || r == RoleAdmin }

func (r Role) rank() int {
	switch r {
	case RoleAdmin:
		return 2
	case RoleMember:
		return 1
	}
	return 0
}

// Higher returns the higher of two roles (admin > member > none).
func Higher(a, b Role) Role {
	if b.rank() > a.rank() {
		return b
	}
	return a
}

// EffectiveRole is the higher of the SSO and manual role sources (spec §7.5).
func EffectiveRole(sso, manual Role) Role { return Higher(sso, manual) }

type Claim string

const (
	ClaimGroups Claim = "groups"
	ClaimRoles  Claim = "roles"
)

// RoleMapping maps a token claim value to a team role (spec §7.4).
type RoleMapping struct {
	ID          string `bson:"_id" json:"id"`
	Claim       Claim  `bson:"claim" json:"claim"`
	Pattern     string `bson:"pattern" json:"pattern"`
	Team        string `bson:"team" json:"team"`
	Role        Role   `bson:"role" json:"role"`
	Enabled     bool   `bson:"enabled" json:"enabled"`
	Managed     bool   `bson:"managed" json:"managed"`
	Description string `bson:"description" json:"description"`
	Version     int64  `bson:"version" json:"version"`
}

// Validate checks the pattern syntax and that team capture references exist.
func (m RoleMapping) Validate() error {
	if m.Claim != ClaimGroups && m.Claim != ClaimRoles {
		return fmt.Errorf("claim must be %q or %q", ClaimGroups, ClaimRoles)
	}
	if !m.Role.Valid() {
		return errors.New("role must be member or admin")
	}
	if strings.TrimSpace(m.Pattern) == "" || strings.TrimSpace(m.Team) == "" {
		return errors.New("pattern and team are required")
	}
	segs := strings.Split(m.Pattern, "/")
	wild := 0
	for _, s := range segs {
		if strings.Contains(s, "*") && s != "*" {
			return fmt.Errorf("pattern segment %q: * must be a whole segment", s)
		}
		if s == "*" {
			wild++
		}
	}
	for _, n := range captureRefs(m.Team) {
		if n < 1 || n > wild {
			return fmt.Errorf("team references $%d but pattern has %d wildcard(s)", n, wild)
		}
	}
	return nil
}

// captureRefs returns the numbers of $N references in s.
func captureRefs(s string) []int {
	var out []int
	for i := 0; i < len(s); i++ {
		if s[i] != '$' {
			continue
		}
		j := i + 1
		n := 0
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			n = n*10 + int(s[j]-'0')
			j++
		}
		if j > i+1 {
			out = append(out, n)
			i = j - 1
		}
	}
	return out
}

// Match reports whether value matches the mapping pattern and, if so, the
// resolved team slug. `*` matches exactly one non-empty `/`-separated segment.
func (m RoleMapping) Match(value string) (team string, ok bool) {
	ps, vs := strings.Split(m.Pattern, "/"), strings.Split(value, "/")
	if len(ps) != len(vs) {
		return "", false
	}
	var caps []string
	for i := range ps {
		if ps[i] == "*" {
			if vs[i] == "" {
				return "", false
			}
			caps = append(caps, vs[i])
		} else if ps[i] != vs[i] {
			return "", false
		}
	}
	team = m.Team
	// Replace from the highest index down so $1 does not clobber $10.
	for n := len(caps); n >= 1; n-- {
		team = strings.ReplaceAll(team, fmt.Sprintf("$%d", n), caps[n-1])
	}
	return team, true
}

// DesiredSSORoles evaluates enabled rules against the principal's claim values
// and returns teamSlug → highest matched role (spec §7.5 steps 1–2).
func DesiredSSORoles(rules []RoleMapping, groups, roles []string) map[string]Role {
	out := map[string]Role{}
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		values := groups
		if r.Claim == ClaimRoles {
			values = roles
		}
		for _, v := range values {
			if team, ok := r.Match(v); ok {
				out[team] = Higher(out[team], r.Role)
			}
		}
	}
	return out
}
