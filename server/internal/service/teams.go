package service

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

type Teams struct {
	st    *store.Store
	audit *audit.Log
	// supportedCurrencies bounds reference rates; baseCurrency is excluded from rates.
	supported []string
	base      string
}

func NewTeams(st *store.Store, a *audit.Log, base string, supported []string) *Teams {
	return &Teams{st: st, audit: a, base: base, supported: supported}
}

// ActorFor loads effective team roles for the user (httpapi.MembershipLoader).
func (s *Teams) ActorFor(ctx context.Context, u *domain.User, p *auth.Principal) (authz.Actor, error) {
	ms, err := s.st.MembershipsByUser(ctx, u.ID)
	if err != nil {
		return authz.Actor{}, err
	}
	roles := make(map[bson.ObjectID]domain.Role, len(ms))
	for _, m := range ms {
		roles[m.TeamID] = m.Effective()
	}
	return authz.Actor{UserID: u.ID, IsSystemAdmin: p.IsSystemAdmin, IsPurchaser: p.IsPurchaser, IsReceiver: p.IsReceiver, TeamRoles: roles}, nil
}

func mapStore(err error) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, store.ErrVersionConflict):
		return ErrVersionConflict
	}
	return err
}

// ---- team CRUD ----

type CreateTeamInput struct {
	Slug         string
	Name         string
	Description  string
	FirstAdminID bson.ObjectID
}

// Create creates a team and makes FirstAdminID its first admin (system admin only).
func (s *Teams) Create(ctx context.Context, actor authz.Actor, in CreateTeamInput) (*domain.Team, error) {
	if !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	if !slugRe.MatchString(in.Slug) || len(in.Slug) > 63 {
		return nil, Invalid("slug", "must match [a-z0-9-] without leading/trailing/double hyphens")
	}
	if err := validName(in.Name); err != nil {
		return nil, err
	}
	if _, err := s.st.GetUser(ctx, in.FirstAdminID); err != nil {
		return nil, Invalid("firstAdminUserId", "user not found")
	}
	t := &domain.Team{
		Slug: in.Slug, Name: strings.TrimSpace(in.Name), Description: in.Description,
		Visibility: domain.VisibilityPublic, Locale: domain.LocaleEN,
	}
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		if err := s.st.CreateTeam(ctx, t); err != nil {
			if errors.Is(err, store.ErrDuplicate) {
				return Rule("team_slug_taken", "A team with slug %q already exists.", in.Slug)
			}
			return err
		}
		m := &domain.Membership{TeamID: t.ID, UserID: in.FirstAdminID, ManualRole: domain.RoleAdmin}
		if err := s.st.InsertMembership(ctx, m); err != nil {
			return err
		}
		return s.audit.Record(ctx,
			domain.AuditEvent{Actor: actor.UserID.Hex(), TeamIDs: []bson.ObjectID{t.ID}, ObjectType: "team", ObjectID: t.ID.Hex(), Action: "team.created"},
			domain.AuditEvent{Actor: actor.UserID.Hex(), TeamIDs: []bson.ObjectID{t.ID}, ObjectType: "membership", ObjectID: in.FirstAdminID.Hex(),
				Action: "membership.manual_role_set", Changes: []domain.AuditChange{{Field: "manualRole", From: "", To: "admin"}}},
		)
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

func validName(n string) error {
	n = strings.TrimSpace(n)
	if n == "" || utf8.RuneCountInString(n) > 200 {
		return Invalid("name", "required, at most 200 characters")
	}
	return nil
}

func (s *Teams) List(ctx context.Context) ([]domain.Team, error) { return s.st.ListTeams(ctx) }

func (s *Teams) GetBySlug(ctx context.Context, slug string) (*domain.Team, error) {
	t, err := s.st.GetTeamBySlug(ctx, slug)
	return t, mapStore(err)
}

// TeamPatch holds optional changes; nil means unchanged.
type TeamPatch struct {
	Name           *string
	Description    *string
	Visibility     *domain.Visibility
	Locale         *domain.Locale
	PriorityLabels *map[string]string
}

func (s *Teams) Update(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, p TeamPatch) (*domain.Team, error) {
	t, err := s.st.GetTeam(ctx, teamID)
	if err != nil {
		return nil, mapStore(err)
	}
	if !actor.CanAdminTeam(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	var set bson.D
	var changes []domain.AuditChange
	chg := func(field string, from, to any) {
		set = append(set, bson.E{Key: field, Value: to})
		changes = append(changes, domain.AuditChange{Field: field, From: from, To: to})
	}
	if p.Name != nil && *p.Name != t.Name {
		if err := validName(*p.Name); err != nil {
			return nil, err
		}
		chg("name", t.Name, strings.TrimSpace(*p.Name))
	}
	if p.Description != nil && *p.Description != t.Description {
		chg("description", t.Description, *p.Description)
	}
	if p.Visibility != nil && *p.Visibility != t.Visibility {
		if !p.Visibility.Valid() {
			return nil, Invalid("visibility", "must be public or members")
		}
		chg("visibility", t.Visibility, *p.Visibility)
	}
	if p.Locale != nil && *p.Locale != t.Locale {
		if !p.Locale.Valid() {
			return nil, Invalid("locale", "must be en or zh-TW")
		}
		chg("locale", t.Locale, *p.Locale)
	}
	if p.PriorityLabels != nil {
		for k, v := range *p.PriorityLabels {
			if k != "1" && k != "2" && k != "3" && k != "4" && k != "5" {
				return nil, Invalid("priorityLabels", "keys must be \"1\" to \"5\"")
			}
			if utf8.RuneCountInString(v) > 200 {
				return nil, Invalid("priorityLabels", "labels are at most 200 characters")
			}
		}
		chg("priorityLabels", t.PriorityLabels, *p.PriorityLabels)
	}
	return s.applyTeamChange(ctx, actor, t, version, set, changes, "team.updated")
}

func (s *Teams) applyTeamChange(ctx context.Context, actor authz.Actor, t *domain.Team, version int64, set bson.D, changes []domain.AuditChange, action string) (*domain.Team, error) {
	if len(set) == 0 {
		if t.Version != version {
			return nil, ErrVersionConflict
		}
		return t, nil
	}
	var out domain.Team
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		if err := s.st.UpdateVersioned(ctx, "teams", t.ID, version, set, &out); err != nil {
			return mapStore(err)
		}
		return s.audit.Record(ctx, domain.AuditEvent{
			Actor: actor.UserID.Hex(), TeamIDs: []bson.ObjectID{t.ID}, ObjectType: "team", ObjectID: t.ID.Hex(), Action: action, Changes: changes,
		})
	})
	if err != nil {
		return nil, err
	}
	store.NormalizeTeam(&out)
	return &out, nil
}

// SetArchived archives or unarchives a team (system admin only).
func (s *Teams) SetArchived(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, archived bool) (*domain.Team, error) {
	if !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	t, err := s.st.GetTeam(ctx, teamID)
	if err != nil {
		return nil, mapStore(err)
	}
	return s.applyTeamChange(ctx, actor, t, version,
		bson.D{{Key: "archived", Value: archived}},
		[]domain.AuditChange{{Field: "archived", From: t.Archived, To: archived}}, "team.archived_changed")
}

// ---- subgroups ----

// cleanAliases trims aliases and drops empty and duplicate ones and ones equal to the subgroup's
// own name, comparing by domain.NameKey.
func cleanAliases(name string, in []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{domain.NameKey(name): true}
	for _, a := range in {
		a = strings.TrimSpace(a)
		k := domain.NameKey(a)
		if a == "" || seen[k] {
			continue
		}
		if utf8.RuneCountInString(a) > 200 {
			return nil, Invalid("aliases", "at most 200 characters each")
		}
		seen[k] = true
		out = append(out, a)
	}
	if len(out) > 50 {
		return nil, Invalid("aliases", "at most 50")
	}
	return out, nil
}

// checkSubgroupNames rejects a name or alias used by another subgroup of the team (the one at
// index self, or -1 for none), compared by domain.NameKey and including inactive subgroups. The
// aliases must already be cleaned by cleanAliases. details.value is the clashing value.
func checkSubgroupNames(sgs []domain.Subgroup, self int, name string, aliases []string) error {
	taken := map[string]bool{}
	for i, g := range sgs {
		if i == self {
			continue
		}
		taken[domain.NameKey(g.Name)] = true
		for _, a := range g.Aliases {
			taken[domain.NameKey(a)] = true
		}
	}
	for _, v := range append([]string{name}, aliases...) {
		if taken[domain.NameKey(v)] {
			e := Rule("subgroup_name_conflict", "The name or alias %q is already used by another subgroup.", v)
			e.Details = map[string]any{"value": v}
			return e
		}
	}
	return nil
}

func (s *Teams) AddSubgroup(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, name string, aliases []string) (*domain.Team, error) {
	t, err := s.writableTeamAdmin(ctx, actor, teamID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if err := validName(name); err != nil {
		return nil, err
	}
	aliases, err = cleanAliases(name, aliases)
	if err != nil {
		return nil, err
	}
	if err := checkSubgroupNames(t.Subgroups, -1, name, aliases); err != nil {
		return nil, err
	}
	sgs := append(append([]domain.Subgroup{}, t.Subgroups...), domain.Subgroup{ID: bson.NewObjectID().Hex(), Name: name, Aliases: aliases, Active: true})
	changes := []domain.AuditChange{{Field: "subgroups", From: nil, To: name}}
	if len(aliases) > 0 {
		changes = append(changes, domain.AuditChange{Field: "subgroup.aliases", From: nil, To: aliases})
	}
	return s.applyTeamChange(ctx, actor, t, version, bson.D{{Key: "subgroups", Value: sgs}}, changes, "team.subgroup_added")
}

// UpdateSubgroup renames, replaces the aliases of and/or (de)activates a subgroup. Subgroups are never deleted.
func (s *Teams) UpdateSubgroup(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, id string, name *string, aliases *[]string, active *bool) (*domain.Team, error) {
	t, err := s.writableTeamAdmin(ctx, actor, teamID)
	if err != nil {
		return nil, err
	}
	sgs := append([]domain.Subgroup{}, t.Subgroups...)
	idx := -1
	for i, g := range sgs {
		if g.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		return nil, ErrNotFound
	}
	newName := sgs[idx].Name
	newAliases := sgs[idx].Aliases
	if name != nil {
		newName = strings.TrimSpace(*name)
		if err := validName(newName); err != nil {
			return nil, err
		}
	}
	if aliases != nil {
		newAliases = *aliases
	}
	// Cleaned against the final name, so a rename to one of the subgroup's own aliases drops that
	// alias. A PATCH that sends neither name nor aliases leaves the stored aliases as they are.
	if name != nil || aliases != nil {
		if newAliases, err = cleanAliases(newName, newAliases); err != nil {
			return nil, err
		}
	}
	var changes []domain.AuditChange
	if newName != sgs[idx].Name || !slices.Equal(newAliases, sgs[idx].Aliases) {
		if err := checkSubgroupNames(sgs, idx, newName, newAliases); err != nil {
			return nil, err
		}
	}
	if newName != sgs[idx].Name {
		changes = append(changes, domain.AuditChange{Field: "subgroup.name", From: sgs[idx].Name, To: newName})
		sgs[idx].Name = newName
	}
	if !slices.Equal(newAliases, sgs[idx].Aliases) {
		changes = append(changes, domain.AuditChange{Field: "subgroup.aliases", From: sgs[idx].Aliases, To: newAliases})
		sgs[idx].Aliases = newAliases
	}
	if active != nil && *active != sgs[idx].Active {
		changes = append(changes, domain.AuditChange{Field: "subgroup.active", From: sgs[idx].Active, To: *active})
		sgs[idx].Active = *active
	}
	if len(changes) == 0 {
		return s.applyTeamChange(ctx, actor, t, version, nil, nil, "")
	}
	return s.applyTeamChange(ctx, actor, t, version, bson.D{{Key: "subgroups", Value: sgs}}, changes, "team.subgroup_updated")
}

func (s *Teams) writableTeamAdmin(ctx context.Context, actor authz.Actor, teamID bson.ObjectID) (*domain.Team, error) {
	t, err := s.st.GetTeam(ctx, teamID)
	if err != nil {
		return nil, mapStore(err)
	}
	if !actor.CanAdminTeam(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	return t, nil
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func (s *Teams) GetByID(ctx context.Context, id bson.ObjectID) (*domain.Team, error) {
	t, err := s.st.GetTeam(ctx, id)
	return t, mapStore(err)
}
