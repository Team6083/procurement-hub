package authz

import (
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

func TestCanReadBatch(t *testing.T) {
	team, other := bson.NewObjectID(), bson.NewObjectID()
	member := Actor{TeamRoles: map[bson.ObjectID]domain.Role{team: domain.RoleMember}}
	outsider := Actor{TeamRoles: map[bson.ObjectID]domain.Role{other: domain.RoleMember}}
	sysadmin := Actor{IsSystemAdmin: true}

	pub, mem := domain.VisibilityPublic, domain.VisibilityMembers
	tests := []struct {
		name          string
		a             Actor
		teamVis, over domain.Visibility
		want          bool
	}{
		{"member of members team", member, mem, "", true},
		{"outsider, members team", outsider, mem, "", false},
		{"outsider, public team", outsider, pub, "", true},
		{"outsider, public team, members override", outsider, pub, mem, false},
		{"outsider, members team, public override", outsider, mem, pub, true},
		{"system admin sees members batch", sysadmin, mem, "", true},
		{"anonymous-like actor, members", Actor{}, mem, "", false},
	}
	for _, tt := range tests {
		if got := tt.a.CanReadBatch(team, tt.teamVis, tt.over); got != tt.want {
			t.Errorf("%s: got %v want %v", tt.name, got, tt.want)
		}
	}
}

func TestBatchRoles(t *testing.T) {
	team := bson.NewObjectID()
	appr, admin, plain := bson.NewObjectID(), bson.NewObjectID(), bson.NewObjectID()
	as := Assignments{Approvers: []bson.ObjectID{appr}}
	roles := map[bson.ObjectID]domain.Role{team: domain.RoleMember}

	if !(Actor{UserID: appr, TeamRoles: roles}).HasBatchRole(team, as, BatchApprover) {
		t.Error("assigned approver should hold role")
	}
	if (Actor{UserID: appr, TeamRoles: roles}).HasBatchRole(team, as, BatchPurchaser) {
		t.Error("approver must not be purchaser")
	}
	adminActor := Actor{UserID: admin, TeamRoles: map[bson.ObjectID]domain.Role{team: domain.RoleAdmin}}
	for _, r := range []BatchRole{BatchApprover, BatchPurchaser, BatchReceiver} {
		if !adminActor.HasBatchRole(team, as, r) {
			t.Errorf("team admin should implicitly hold %s", r)
		}
		if IsExplicitAssignee(admin, as, r) {
			t.Errorf("team admin is not an explicit %s", r)
		}
	}
	if (Actor{UserID: plain, TeamRoles: roles}).HasBatchRole(team, as, BatchReceiver) {
		t.Error("plain member holds no batch role")
	}
	if (Actor{UserID: plain, IsSystemAdmin: true}).HasBatchRole(team, as, BatchApprover) {
		t.Error("system admin must not implicitly hold batch roles")
	}
}

func TestHasBatchRoleOnAll(t *testing.T) {
	teamA, teamB := bson.NewObjectID(), bson.NewObjectID()
	buyer, admin := bson.NewObjectID(), bson.NewObjectID()
	refA := BatchRef{TeamID: teamA, Assignments: Assignments{Purchasers: []bson.ObjectID{buyer}}}
	refB := BatchRef{TeamID: teamB, Assignments: Assignments{Purchasers: []bson.ObjectID{buyer}}}
	refBOther := BatchRef{TeamID: teamB, Assignments: Assignments{Purchasers: []bson.ObjectID{bson.NewObjectID()}}}
	member := map[bson.ObjectID]domain.Role{teamA: domain.RoleMember, teamB: domain.RoleMember}

	tests := []struct {
		name string
		a    Actor
		refs []BatchRef
		want bool
	}{
		{"purchaser of both", Actor{UserID: buyer, TeamRoles: member}, []BatchRef{refA, refB}, true},
		{"purchaser of one only", Actor{UserID: buyer, TeamRoles: member}, []BatchRef{refA, refBOther}, false},
		{"team admin of one covers it, the other needs assignment",
			Actor{UserID: admin, TeamRoles: map[bson.ObjectID]domain.Role{teamB: domain.RoleAdmin, teamA: domain.RoleMember}},
			[]BatchRef{refBOther, refA}, false},
		{"team admin of both",
			Actor{UserID: admin, TeamRoles: map[bson.ObjectID]domain.Role{teamB: domain.RoleAdmin, teamA: domain.RoleAdmin}},
			[]BatchRef{refBOther, refA}, true},
		{"system admin has no implicit role", Actor{UserID: admin, IsSystemAdmin: true}, []BatchRef{refA}, false},
		{"nothing to hold", Actor{UserID: buyer, TeamRoles: member}, nil, false},
	}
	for _, tt := range tests {
		if got := tt.a.HasBatchRoleOnAll(tt.refs, BatchPurchaser); got != tt.want {
			t.Errorf("%s: got %v want %v", tt.name, got, tt.want)
		}
	}
}
