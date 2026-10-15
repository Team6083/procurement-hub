package service

import (
	"testing"

	"github.com/OWNER/procurement-hub/internal/domain"
)

func TestParseRuleFile(t *testing.T) {
	good := `
rules:
  - id: all-team-members
    claim: groups
    pattern: /teams/*/members
    team: $1
    role: member
  - id: off
    claim: roles
    pattern: buyer
    team: ops
    role: admin
    enabled: false
`
	rules, err := ParseRuleFile([]byte(good))
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 2 || !rules[0].Enabled || rules[1].Enabled || !rules[0].Managed || rules[0].Role != domain.RoleMember {
		t.Fatalf("unexpected rules: %+v", rules)
	}

	bad := map[string]string{
		"missing id":    "rules:\n  - claim: groups\n    pattern: /a\n    team: a\n    role: member\n",
		"duplicate id":  "rules:\n  - {id: x, claim: groups, pattern: /a, team: a, role: member}\n  - {id: x, claim: groups, pattern: /b, team: b, role: member}\n",
		"bad role":      "rules:\n  - {id: x, claim: groups, pattern: /a, team: a, role: owner}\n",
		"bad capture":   "rules:\n  - {id: x, claim: groups, pattern: /a, team: $1, role: member}\n",
		"unknown field": "rules:\n  - {id: x, claim: groups, pattern: /a, team: a, role: member, extra: 1}\n",
	}
	for name, doc := range bad {
		if _, err := ParseRuleFile([]byte(doc)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	if r, err := ParseRuleFile([]byte("")); err != nil || len(r) != 0 {
		t.Errorf("empty file: %v %v", r, err)
	}
}
