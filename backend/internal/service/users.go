package service

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/authz"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
)

type Users struct{ st *store.Store }

func NewUsers(st *store.Store) *Users { return &Users{st: st} }

// MyMembership is one team membership of the calling user.
type MyMembership struct {
	TeamID            bson.ObjectID
	Slug              string
	Name              string
	Role              domain.Role
	SSORole           domain.Role
	ManualRole        domain.Role
	DefaultSubgroupID string
}

func (s *Users) Memberships(ctx context.Context, userID bson.ObjectID) ([]MyMembership, error) {
	ms, err := s.st.MembershipsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]MyMembership, 0, len(ms))
	for _, m := range ms {
		t, err := s.st.GetTeam(ctx, m.TeamID)
		if err != nil {
			return nil, mapStore(err)
		}
		out = append(out, MyMembership{
			TeamID: t.ID, Slug: t.Slug, Name: t.Name, Role: m.Effective(),
			SSORole: m.SSORole, ManualRole: m.ManualRole, DefaultSubgroupID: m.DefaultSubgroupID,
		})
	}
	return out, nil
}

type ProfilePatch struct {
	Locale            *domain.Locale
	NotificationPrefs *map[string]domain.NotificationPref
}

func (s *Users) UpdateProfile(ctx context.Context, userID bson.ObjectID, version int64, p ProfilePatch) (*domain.User, error) {
	var set bson.D
	if p.Locale != nil {
		if !p.Locale.Valid() {
			return nil, Invalid("locale", "must be en or zh-TW")
		}
		set = append(set, bson.E{Key: "locale", Value: *p.Locale})
	}
	if p.NotificationPrefs != nil {
		for k := range *p.NotificationPrefs {
			if k == "" || len(k) > 100 {
				return nil, Invalid("notificationPrefs", "invalid event type key")
			}
		}
		set = append(set, bson.E{Key: "notificationPrefs", Value: *p.NotificationPrefs})
	}
	if len(set) == 0 {
		u, err := s.st.GetUser(ctx, userID)
		if err != nil {
			return nil, mapStore(err)
		}
		if u.Version != version {
			return nil, ErrVersionConflict
		}
		return u, nil
	}
	var u domain.User
	if err := s.st.UpdateVersioned(ctx, "users", userID, version, set, &u); err != nil {
		return nil, mapStore(err)
	}
	return &u, nil
}

// Search finds users who have logged in at least once. Only members of some
// team or system admins may search, to limit directory enumeration.
func (s *Users) Search(ctx context.Context, actor authz.Actor, q string) ([]domain.User, error) {
	if !actor.IsSystemAdmin && len(actor.TeamRoles) == 0 {
		return nil, ErrForbidden
	}
	q = strings.TrimSpace(q)
	if len(q) < 2 {
		return nil, Invalid("q", "at least 2 characters")
	}
	return s.st.SearchUsers(ctx, q, 20)
}
