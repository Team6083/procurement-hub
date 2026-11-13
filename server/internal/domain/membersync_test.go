package domain

import (
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestPlanMembershipSync(t *testing.T) {
	a, b, c, d := bson.NewObjectID(), bson.NewObjectID(), bson.NewObjectID(), bson.NewObjectID()
	existing := []Membership{
		{TeamID: a, SSORole: RoleMember},                        // unchanged
		{TeamID: b, SSORole: RoleMember},                        // sso removed, no manual -> delete
		{TeamID: c, SSORole: RoleMember, ManualRole: RoleAdmin}, // sso removed, manual kept -> update
		{TeamID: d, ManualRole: RoleMember},                     // manual only, gains sso admin -> update
	}
	e := bson.NewObjectID()
	desired := map[bson.ObjectID]Role{a: RoleMember, d: RoleAdmin, e: RoleAdmin}

	got := map[bson.ObjectID]SyncChange{}
	for _, ch := range PlanMembershipSync(existing, desired) {
		got[ch.TeamID] = ch
	}
	if len(got) != 4 {
		t.Fatalf("want 4 changes, got %d: %+v", len(got), got)
	}
	if _, ok := got[a]; ok {
		t.Error("unchanged membership produced a change")
	}
	if got[b].Action != SyncDelete {
		t.Errorf("b: %v", got[b].Action)
	}
	if ch := got[c]; ch.Action != SyncUpdate || ch.NewSSO != RoleNone {
		t.Errorf("c: %+v", ch)
	}
	if ch := got[d]; ch.Action != SyncUpdate || ch.NewSSO != RoleAdmin || ch.OldSSO != RoleNone {
		t.Errorf("d: %+v", ch)
	}
	if ch := got[e]; ch.Action != SyncCreate || ch.NewSSO != RoleAdmin || ch.Membership != nil {
		t.Errorf("e: %+v", ch)
	}
}

func TestPlanMembershipSyncEmpty(t *testing.T) {
	if got := PlanMembershipSync(nil, nil); len(got) != 0 {
		t.Fatalf("want none, got %v", got)
	}
}
