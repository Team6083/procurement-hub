package domain

import (
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type SyncAction string

const (
	SyncCreate SyncAction = "create"
	SyncUpdate SyncAction = "update"
	SyncDelete SyncAction = "delete"
)

// SyncChange is one membership mutation decided by PlanMembershipSync.
type SyncChange struct {
	Action     SyncAction
	TeamID     bson.ObjectID
	Membership *Membership // nil for SyncCreate
	OldSSO     Role
	NewSSO     Role
}

// PlanMembershipSync computes the membership changes that make every SSO role
// match `desired` (teamID → role), per spec §7.5 step 3:
//   - existing memberships get ssoRole = desired or none;
//   - desired teams without a membership are created;
//   - memberships left with neither source are deleted.
//
// Manual roles are never touched. Unchanged memberships yield no change.
func PlanMembershipSync(existing []Membership, desired map[bson.ObjectID]Role) []SyncChange {
	var out []SyncChange
	seen := map[bson.ObjectID]bool{}
	for i := range existing {
		m := &existing[i]
		seen[m.TeamID] = true
		want := desired[m.TeamID]
		if m.SSORole == want {
			continue
		}
		c := SyncChange{TeamID: m.TeamID, Membership: m, OldSSO: m.SSORole, NewSSO: want}
		if want == RoleNone && m.ManualRole == RoleNone {
			c.Action = SyncDelete
		} else {
			c.Action = SyncUpdate
		}
		out = append(out, c)
	}
	for team, role := range desired {
		if !seen[team] && role != RoleNone {
			out = append(out, SyncChange{Action: SyncCreate, TeamID: team, NewSSO: role})
		}
	}
	// Deterministic order for stable audit output and tests.
	sort.Slice(out, func(i, j int) bool { return out[i].TeamID.Hex() < out[j].TeamID.Hex() })
	return out
}
