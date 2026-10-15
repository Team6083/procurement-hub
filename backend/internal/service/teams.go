package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/authz"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
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
func (s *Teams) ActorFor(ctx context.Context, u *domain.User, isSystemAdmin bool) (authz.Actor, error) {
	ms, err := s.st.MembershipsByUser(ctx, u.ID)
	if err != nil {
		return authz.Actor{}, err
	}
	roles := make(map[bson.ObjectID]domain.Role, len(ms))
	for _, m := range ms {
		roles[m.TeamID] = m.Effective()
	}
	return authz.Actor{UserID: u.ID, IsSystemAdmin: isSystemAdmin, TeamRoles: roles}, nil
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
				return Rule("TEAM_SLUG_TAKEN", "A team with slug %q already exists.", in.Slug)
			}
			return err
		}
		m := &domain.Membership{TeamID: t.ID, UserID: in.FirstAdminID, ManualRole: domain.RoleAdmin}
		if err := s.st.InsertMembership(ctx, m); err != nil {
			return err
		}
		return s.audit.Record(ctx,
			domain.AuditEvent{Actor: actor.UserID.Hex(), TeamID: t.ID, ObjectType: "team", ObjectID: t.ID.Hex(), Action: "team.created"},
			domain.AuditEvent{Actor: actor.UserID.Hex(), TeamID: t.ID, ObjectType: "membership", ObjectID: in.FirstAdminID.Hex(),
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
		return nil, Rule("TEAM_ARCHIVED", "Archived teams are read-only.")
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
			Actor: actor.UserID.Hex(), TeamID: t.ID, ObjectType: "team", ObjectID: t.ID.Hex(), Action: action, Changes: changes,
		})
	})
	if err != nil {
		return nil, err
	}
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

func (s *Teams) AddSubgroup(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, name string) (*domain.Team, error) {
	t, err := s.writableTeamAdmin(ctx, actor, teamID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if err := validName(name); err != nil {
		return nil, err
	}
	for _, g := range t.Subgroups {
		if strings.EqualFold(g.Name, name) {
			return nil, Rule("SUBGROUP_EXISTS", "A subgroup named %q already exists.", name)
		}
	}
	sgs := append(append([]domain.Subgroup{}, t.Subgroups...), domain.Subgroup{ID: bson.NewObjectID().Hex(), Name: name, Active: true})
	return s.applyTeamChange(ctx, actor, t, version, bson.D{{Key: "subgroups", Value: sgs}},
		[]domain.AuditChange{{Field: "subgroups", From: nil, To: name}}, "team.subgroup_added")
}

// UpdateSubgroup renames and/or (de)activates a subgroup. Subgroups are never deleted.
func (s *Teams) UpdateSubgroup(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, id string, name *string, active *bool) (*domain.Team, error) {
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
	var changes []domain.AuditChange
	if name != nil && strings.TrimSpace(*name) != sgs[idx].Name {
		n := strings.TrimSpace(*name)
		if err := validName(n); err != nil {
			return nil, err
		}
		for i, g := range sgs {
			if i != idx && strings.EqualFold(g.Name, n) {
				return nil, Rule("SUBGROUP_EXISTS", "A subgroup named %q already exists.", n)
			}
		}
		changes = append(changes, domain.AuditChange{Field: "subgroup.name", From: sgs[idx].Name, To: n})
		sgs[idx].Name = n
	}
	if active != nil && *active != sgs[idx].Active {
		changes = append(changes, domain.AuditChange{Field: "subgroup.active", From: sgs[idx].Active, To: *active})
		sgs[idx].Active = *active
	}
	if len(changes) == 0 {
		return t, nil
	}
	return s.applyTeamChange(ctx, actor, t, version, bson.D{{Key: "subgroups", Value: sgs}}, changes, "team.subgroup_updated")
}

// ---- reference rates ----

type RateInput struct {
	Currency   string
	RateToBase string
}

// ReplaceReferenceRates replaces the full rate list (spec §16.2 PUT).
func (s *Teams) ReplaceReferenceRates(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, version int64, in []RateInput) (*domain.Team, error) {
	t, err := s.writableTeamAdmin(ctx, actor, teamID)
	if err != nil {
		return nil, err
	}
	prev := map[string]domain.ReferenceRate{}
	for _, r := range t.ReferenceRates {
		prev[r.Currency] = r
	}
	now := bsonNow()
	seen := map[string]bool{}
	rates := []domain.ReferenceRate{}
	for _, r := range in {
		cur := strings.ToUpper(strings.TrimSpace(r.Currency))
		if cur == s.base {
			return nil, Invalid("currency", "the base currency needs no rate")
		}
		if !contains(s.supported, cur) {
			return nil, Invalid("currency", cur+" is not a supported currency")
		}
		if seen[cur] {
			return nil, Invalid("currency", "duplicate currency "+cur)
		}
		seen[cur] = true
		d, err := decimal.NewFromString(r.RateToBase)
		if err != nil || !d.IsPositive() {
			return nil, Invalid("rateToBase", "must be a positive decimal string")
		}
		rate := domain.ReferenceRate{Currency: cur, RateToBase: d.String(), UpdatedAt: now, UpdatedBy: actor.UserID.Hex()}
		if p, ok := prev[cur]; ok && p.RateToBase == rate.RateToBase {
			rate.UpdatedAt, rate.UpdatedBy = p.UpdatedAt, p.UpdatedBy // unchanged
		}
		rates = append(rates, rate)
	}
	return s.applyTeamChange(ctx, actor, t, version, bson.D{{Key: "referenceRates", Value: rates}},
		[]domain.AuditChange{{Field: "referenceRates", From: t.ReferenceRates, To: rates}}, "team.reference_rates_replaced")
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
		return nil, Rule("TEAM_ARCHIVED", "Archived teams are read-only.")
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
