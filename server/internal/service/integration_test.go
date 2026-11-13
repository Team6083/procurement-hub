package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// testStore connects to TEST_MONGODB_URI (must be a replica set) using a
// throwaway database, or skips the test when it is not set.
func testStore(t *testing.T) *store.Store {
	t.Helper()
	uri := os.Getenv("TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("TEST_MONGODB_URI not set")
	}
	ctx := context.Background()
	db := fmt.Sprintf("ph_test_%d", time.Now().UnixNano())
	st, err := store.Connect(ctx, uri, db)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = st.DB.Drop(ctx)
		_ = st.Close(ctx)
	})
	return st
}

// Acceptance criterion 1: a mapped group adds the membership automatically,
// removing the group removes it, and a manual membership survives.
func TestSSOSyncLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	log := audit.New(st.DB)
	identity := NewIdentity(st, log)
	teams := NewTeams(st, log, "USD", []string{"USD"})

	if err := st.PutRoleMapping(ctx, domain.RoleMapping{
		ID: "m", Claim: domain.ClaimGroups, Pattern: "/teams/*/members", Team: "$1", Role: domain.RoleMember, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	admin, err := st.UpsertUser(ctx, "admin-sub", "root", "root@example.org", "Root")
	if err != nil {
		t.Fatal(err)
	}
	sys := authz.Actor{UserID: admin.ID, IsSystemAdmin: true}
	alpha, err := teams.Create(ctx, sys, CreateTeamInput{Slug: "alpha", Name: "Alpha", FirstAdminID: admin.ID})
	if err != nil {
		t.Fatal(err)
	}
	beta, err := teams.Create(ctx, sys, CreateTeamInput{Slug: "beta", Name: "Beta", FirstAdminID: admin.ID})
	if err != nil {
		t.Fatal(err)
	}

	p := &auth.Principal{Sub: "kai-sub", PreferredUsername: "kai", IssuedAt: time.Now().Add(-time.Hour), Groups: []string{"/teams/alpha/members"}}
	u, err := identity.Provision(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	role := func(team bson.ObjectID) domain.Role {
		m, err := st.GetMembership(ctx, team, u.ID)
		if err != nil {
			return domain.RoleNone
		}
		return m.Effective()
	}
	if role(alpha.ID) != domain.RoleMember {
		t.Fatal("mapped group should create membership")
	}

	// A manual membership in beta must survive SSO changes.
	if _, _, err := teams.AddMember(ctx, authz.Actor{UserID: admin.ID, IsSystemAdmin: true}, beta.ID, u.ID, domain.RoleMember); err != nil {
		t.Fatal(err)
	}

	// Newer token without the group: SSO membership is removed, manual stays.
	p2 := &auth.Principal{Sub: "kai-sub", PreferredUsername: "kai", IssuedAt: time.Now()}
	if _, err := identity.Provision(ctx, p2); err != nil {
		t.Fatal(err)
	}
	if role(alpha.ID) != domain.RoleNone {
		t.Error("membership should be removed when the group is gone")
	}
	if role(beta.ID) != domain.RoleMember {
		t.Error("manual membership must survive")
	}

	pg, err := log.PageForTeam(ctx, alpha.ID, bson.ObjectID{}, 50)
	if err != nil {
		t.Fatal(err)
	}
	var sawSync bool
	for _, e := range pg.Events {
		if e.Actor == "system:sso-sync" {
			sawSync = true
		}
	}
	if !sawSync {
		t.Error("expected audit events from system:sso-sync")
	}
}

func TestTeamVersionConflictAndAdminCheck(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	log := audit.New(st.DB)
	teams := NewTeams(st, log, "USD", []string{"USD"})
	admin, _ := st.UpsertUser(ctx, "a", "a", "a@example.org", "A")
	other, _ := st.UpsertUser(ctx, "o", "o", "o@example.org", "O")
	sys := authz.Actor{UserID: admin.ID, IsSystemAdmin: true}
	tm, err := teams.Create(ctx, sys, CreateTeamInput{Slug: "gamma", Name: "Gamma", FirstAdminID: admin.ID})
	if err != nil {
		t.Fatal(err)
	}
	name := "Gamma 2"
	adminActor := authz.Actor{UserID: admin.ID, TeamRoles: map[bson.ObjectID]domain.Role{tm.ID: domain.RoleAdmin}}
	updated, err := teams.Update(ctx, adminActor, tm.ID, tm.Version, TeamPatch{Name: &name})
	if err != nil || updated.Version != tm.Version+1 {
		t.Fatalf("update: %v %+v", err, updated)
	}
	if _, err := teams.Update(ctx, adminActor, tm.ID, tm.Version, TeamPatch{Name: &name}); err == nil {
		t.Error("stale version must conflict")
	}
	outsider := authz.Actor{UserID: other.ID}
	n2 := "x"
	if _, err := teams.Update(ctx, outsider, tm.ID, updated.Version, TeamPatch{Name: &n2}); err != ErrForbidden {
		t.Errorf("non-admin update: %v", err)
	}
	if _, err := teams.Create(ctx, adminActor, CreateTeamInput{Slug: "x", Name: "X", FirstAdminID: admin.ID}); err != ErrForbidden {
		t.Errorf("non-sysadmin create: %v", err)
	}
}
