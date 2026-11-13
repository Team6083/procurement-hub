package service

import (
	"context"
	"errors"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// MemberView joins a membership with its user for API responses.
type MemberView struct {
	Membership domain.Membership
	User       domain.User
	Effective  domain.Role
}

// ListMembers: visible to team members and system admins.
func (s *Teams) ListMembers(ctx context.Context, actor authz.Actor, teamID bson.ObjectID) ([]MemberView, error) {
	if !actor.CanSeeTeamInternals(teamID) {
		return nil, ErrForbidden
	}
	ms, err := s.st.MembershipsByTeam(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]MemberView, 0, len(ms))
	for _, m := range ms {
		u, err := s.st.GetUser(ctx, m.UserID)
		if err != nil {
			return nil, mapStore(err)
		}
		out = append(out, MemberView{Membership: m, User: *u, Effective: m.Effective()})
	}
	return out, nil
}

// AddMember grants a manual role (member or admin) to a user, creating the
// membership if needed. Team admins only.
func (s *Teams) AddMember(ctx context.Context, actor authz.Actor, teamID, userID bson.ObjectID, role domain.Role) (m *domain.Membership, created bool, err error) {
	if !role.Valid() {
		return nil, false, Invalid("role", "must be member or admin")
	}
	if _, err := s.writableTeamAdmin(ctx, actor, teamID); err != nil {
		return nil, false, err
	}
	if _, err := s.st.GetUser(ctx, userID); err != nil {
		return nil, false, Invalid("userId", "user not found")
	}
	var out *domain.Membership
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		m, err := s.st.GetMembership(ctx, teamID, userID)
		switch {
		case errors.Is(err, store.ErrNotFound):
			created = true
			m = &domain.Membership{TeamID: teamID, UserID: userID, ManualRole: role}
			if err := s.st.InsertMembership(ctx, m); err != nil {
				return err
			}
			if err := s.auditManual(ctx, actor, teamID, userID, domain.RoleNone, role); err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			old := m.ManualRole
			if old != role {
				if err := s.st.SetMembershipRoles(ctx, m.ID, m.SSORole, role); err != nil {
					return err
				}
				m.ManualRole = role
				if err := s.auditManual(ctx, actor, teamID, userID, old, role); err != nil {
					return err
				}
			}
		}
		out = m
		return nil
	})
	return out, created, err
}

// MemberPatch: nil fields are unchanged. ManualRole may be cleared via ClearManualRole.
type MemberPatch struct {
	ManualRole      *domain.Role
	ClearManualRole bool
	DefaultSubgroup *string // "" clears
}

// UpdateMember lets team admins set manual role / any default subgroup, and
// lets a member set only their own default subgroup (spec §8.3).
func (s *Teams) UpdateMember(ctx context.Context, actor authz.Actor, teamID, userID bson.ObjectID, version int64, p MemberPatch) (*domain.Membership, error) {
	t, err := s.st.GetTeam(ctx, teamID)
	if err != nil {
		return nil, mapStore(err)
	}
	isAdmin := actor.CanAdminTeam(teamID)
	self := actor.UserID == userID && actor.IsMember(teamID)
	roleChange := p.ManualRole != nil || p.ClearManualRole
	if roleChange && !isAdmin {
		return nil, ErrForbidden
	}
	if p.DefaultSubgroup != nil && !isAdmin && !self {
		return nil, ErrForbidden
	}
	if !isAdmin && !self {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if p.ManualRole != nil && !p.ManualRole.Valid() {
		return nil, Invalid("manualRole", "must be member or admin")
	}
	if p.DefaultSubgroup != nil && *p.DefaultSubgroup != "" {
		ok := false
		for _, g := range t.Subgroups {
			if g.ID == *p.DefaultSubgroup && g.Active {
				ok = true
			}
		}
		if !ok {
			return nil, Invalid("defaultSubgroupId", "unknown or inactive subgroup")
		}
	}
	var out *domain.Membership
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		m, err := s.st.GetMembership(ctx, teamID, userID)
		if err != nil {
			return mapStore(err)
		}
		if m.Version != version {
			return ErrVersionConflict
		}
		if roleChange {
			newManual := domain.RoleNone
			if !p.ClearManualRole {
				newManual = *p.ManualRole
			}
			if newManual != m.ManualRole {
				if newManual == domain.RoleNone && m.SSORole == domain.RoleNone {
					return Rule("member_no_role_source", "Use DELETE to remove a member with no SSO role.")
				}
				if err := s.st.SetMembershipRoles(ctx, m.ID, m.SSORole, newManual); err != nil {
					return err
				}
				if err := s.auditManual(ctx, actor, teamID, userID, m.ManualRole, newManual); err != nil {
					return err
				}
				m.ManualRole = newManual
			}
		}
		if p.DefaultSubgroup != nil && *p.DefaultSubgroup != m.DefaultSubgroupID {
			if err := s.setDefaultSubgroup(ctx, m.ID, *p.DefaultSubgroup); err != nil {
				return err
			}
			m.DefaultSubgroupID = *p.DefaultSubgroup
		}
		out, err = s.st.GetMembership(ctx, teamID, userID) // fresh version after writes
		return err
	})
	return out, err
}

func (s *Teams) setDefaultSubgroup(ctx context.Context, id bson.ObjectID, sg string) error {
	upd := bson.D{{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}}
	if sg == "" {
		upd = append(upd, bson.E{Key: "$unset", Value: bson.D{{Key: "defaultSubgroupId", Value: ""}}})
	} else {
		upd = append(upd, bson.E{Key: "$set", Value: bson.D{{Key: "defaultSubgroupId", Value: sg}}})
	}
	_, err := s.st.DB.Collection("memberships").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, upd)
	return err
}

// RemoveMember clears the manual role. The SSO part cannot be removed by team
// admins (spec §7.5): if an SSO role remains the membership stays.
func (s *Teams) RemoveMember(ctx context.Context, actor authz.Actor, teamID, userID bson.ObjectID, version int64) error {
	if _, err := s.writableTeamAdmin(ctx, actor, teamID); err != nil {
		return err
	}
	return s.st.WithTx(ctx, func(ctx context.Context) error {
		m, err := s.st.GetMembership(ctx, teamID, userID)
		if err != nil {
			return mapStore(err)
		}
		if m.Version != version {
			return ErrVersionConflict
		}
		if m.ManualRole == domain.RoleNone {
			return Rule("member_managed_by_sso", "This membership is managed by SSO and cannot be removed here.")
		}
		if m.SSORole == domain.RoleNone {
			if err := s.st.DeleteMembership(ctx, m.ID); err != nil {
				return err
			}
			if err := removeAssignments(ctx, s.st, s.audit, actor.UserID.Hex(), teamID, userID); err != nil {
				return err
			}
		} else if err := s.st.SetMembershipRoles(ctx, m.ID, m.SSORole, domain.RoleNone); err != nil {
			return err
		}
		return s.auditManual(ctx, actor, teamID, userID, m.ManualRole, domain.RoleNone)
	})
}

func (s *Teams) auditManual(ctx context.Context, actor authz.Actor, teamID, userID bson.ObjectID, from, to domain.Role) error {
	return s.audit.Record(ctx, domain.AuditEvent{
		Actor: actor.UserID.Hex(), TeamID: teamID, ObjectType: "membership", ObjectID: userID.Hex(),
		Action:  "membership.manual_role_set",
		Changes: []domain.AuditChange{{Field: "manualRole", From: string(from), To: string(to)}},
	})
}

// GetMemberView returns one member joined with their user (no permission
// check: callers have already authorised the write that precedes it).
func (s *Teams) GetMemberView(ctx context.Context, teamID, userID bson.ObjectID) (*MemberView, error) {
	m, err := s.st.GetMembership(ctx, teamID, userID)
	if err != nil {
		return nil, mapStore(err)
	}
	u, err := s.st.GetUser(ctx, userID)
	if err != nil {
		return nil, mapStore(err)
	}
	return &MemberView{Membership: *m, User: *u, Effective: m.Effective()}, nil
}
