// Package authz implements permission checks (spec §8). Everything here is a
// pure function of an Actor and the object being accessed.
package authz

import (
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/domain"
)

// Actor describes who is acting: identity plus team memberships.
type Actor struct {
	UserID        bson.ObjectID
	IsSystemAdmin bool
	// TeamRoles maps team → effective membership role.
	TeamRoles map[bson.ObjectID]domain.Role
}

func (a Actor) TeamRole(team bson.ObjectID) domain.Role { return a.TeamRoles[team] }

func (a Actor) IsMember(team bson.ObjectID) bool { return a.TeamRole(team) != domain.RoleNone }

func (a Actor) IsTeamAdmin(team bson.ObjectID) bool { return a.TeamRole(team) == domain.RoleAdmin }

// CanAdminTeam: team admins and system admins.
func (a Actor) CanAdminTeam(team bson.ObjectID) bool { return a.IsSystemAdmin || a.IsTeamAdmin(team) }

// CanSeeTeamInternals: settings, members and channels are visible to members
// and system admins only.
func (a Actor) CanSeeTeamInternals(team bson.ObjectID) bool {
	return a.IsSystemAdmin || a.IsMember(team)
}

// BatchRole is a per-batch assignment role.
type BatchRole string

const (
	BatchApprover  BatchRole = "approver"
	BatchPurchaser BatchRole = "purchaser"
	BatchReceiver  BatchRole = "receiver"
)

// Assignments mirrors batch.assignments.
type Assignments struct {
	Approvers  []bson.ObjectID
	Purchasers []bson.ObjectID
	Receivers  []bson.ObjectID
}

func (as Assignments) list(r BatchRole) []bson.ObjectID {
	switch r {
	case BatchApprover:
		return as.Approvers
	case BatchPurchaser:
		return as.Purchasers
	case BatchReceiver:
		return as.Receivers
	}
	return nil
}

func contains(ids []bson.ObjectID, id bson.ObjectID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// HasBatchRole: explicit assignees, plus team admins who implicitly hold every
// batch role in their team (spec §8.1). System admins do not implicitly act.
func (a Actor) HasBatchRole(team bson.ObjectID, as Assignments, r BatchRole) bool {
	return a.IsTeamAdmin(team) || contains(as.list(r), a.UserID)
}

// IsExplicitAssignee is true only for explicit assignment (used for notification
// recipients; team admins' implicit roles do not count).
func IsExplicitAssignee(userID bson.ObjectID, as Assignments, r BatchRole) bool {
	return contains(as.list(r), userID)
}

// EffectiveVisibility = batch override ?? team visibility (spec §8.2).
func EffectiveVisibility(team domain.Visibility, override domain.Visibility) domain.Visibility {
	if override != "" {
		return override
	}
	return team
}

// CanReadBatch: system admin, team member, or effective visibility public.
func (a Actor) CanReadBatch(team bson.ObjectID, teamVis, override domain.Visibility) bool {
	return a.IsSystemAdmin || a.IsMember(team) || EffectiveVisibility(teamVis, override) == domain.VisibilityPublic
}
