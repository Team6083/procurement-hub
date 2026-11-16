// Package service holds use cases orchestrating domain, store and audit.
package service

import (
	"container/list"
	"context"
	"log/slog"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Identity provisions users just-in-time and syncs SSO memberships (spec §7.3, §7.5).
type Identity struct {
	st    *store.Store
	audit *audit.Log
	cache *iatCache
}

func NewIdentity(st *store.Store, a *audit.Log) *Identity {
	return &Identity{st: st, audit: a, cache: newIATCache(10000)}
}

// Provision upserts the user for the principal and, if the token is newer than
// the last synced one, runs the membership sync. It returns the user document.
func (s *Identity) Provision(ctx context.Context, p *auth.Principal) (*domain.User, error) {
	u, err := s.st.UpsertUser(ctx, p.Sub, p.PreferredUsername, p.Email, p.Name)
	if err != nil {
		return nil, err
	}
	// Fast path: in-process cache avoids reading lastSyncedTokenIat per request.
	last, ok := s.cache.get(p.Sub)
	if !ok {
		last = u.LastSyncedTokenIat
	}
	if !p.IssuedAt.After(last) {
		s.cache.put(p.Sub, last)
		return u, nil
	}
	if err := s.SyncMemberships(ctx, u, p); err != nil {
		return nil, err
	}
	if err := s.st.MarkSynced(ctx, u.ID, p.IssuedAt, p.PreferredUsername, p.Email, p.Name,
		domain.RoleSnapshot{Purchaser: p.IsPurchaser, Receiver: p.IsReceiver, At: time.Now().UTC()}); err != nil {
		return nil, err
	}
	s.cache.put(p.Sub, p.IssuedAt)
	u.Username, u.Email, u.DisplayName = p.PreferredUsername, p.Email, p.Name
	return u, nil
}

// SyncMemberships makes the user's SSO roles match the enabled role mappings.
func (s *Identity) SyncMemberships(ctx context.Context, u *domain.User, p *auth.Principal) error {
	rules, err := s.st.ListRoleMappings(ctx)
	if err != nil {
		return err
	}
	teams, err := s.st.ListTeams(ctx)
	if err != nil {
		return err
	}
	bySlug := make(map[string]bson.ObjectID, len(teams))
	for _, t := range teams {
		bySlug[t.Slug] = t.ID
	}
	desired := map[bson.ObjectID]domain.Role{}
	for slug, role := range domain.DesiredSSORoles(rules, p.Groups, p.Roles) {
		id, ok := bySlug[slug]
		if !ok {
			slog.Debug("role mapping targets unknown team", "team", slug) // sync never creates teams
			continue
		}
		desired[id] = role
	}

	return s.st.WithTx(ctx, func(ctx context.Context) error {
		existing, err := s.st.MembershipsByUser(ctx, u.ID)
		if err != nil {
			return err
		}
		var events []domain.AuditEvent
		for _, ch := range domain.PlanMembershipSync(existing, desired) {
			switch ch.Action {
			case domain.SyncCreate:
				m := &domain.Membership{TeamID: ch.TeamID, UserID: u.ID, SSORole: ch.NewSSO}
				if err := s.st.InsertMembership(ctx, m); err != nil {
					return err
				}
			case domain.SyncUpdate:
				if err := s.st.SetMembershipRoles(ctx, ch.Membership.ID, ch.NewSSO, ch.Membership.ManualRole); err != nil {
					return err
				}
			case domain.SyncDelete:
				if err := s.st.DeleteMembership(ctx, ch.Membership.ID); err != nil {
					return err
				}
				if err := removeAssignments(ctx, s.st, s.audit, audit.SystemActor("sso-sync"), ch.TeamID, u.ID); err != nil {
					return err
				}
			}
			events = append(events, domain.AuditEvent{
				Actor: audit.SystemActor("sso-sync"), TeamID: ch.TeamID,
				ObjectType: "membership", ObjectID: u.ID.Hex(), Action: "membership.sso_" + string(ch.Action),
				Changes: []domain.AuditChange{{Field: "ssoRole", From: string(ch.OldSSO), To: string(ch.NewSSO)}},
			})
		}
		return s.audit.Record(ctx, events...)
	})
}

// iatCache is a small LRU of sub → lastSyncedTokenIat. The database value
// remains authoritative; this only avoids redundant work.
type iatCache struct {
	mu  sync.Mutex
	cap int
	ll  *list.List
	m   map[string]*list.Element
}

type iatEntry struct {
	sub string
	iat time.Time
}

func newIATCache(capacity int) *iatCache {
	return &iatCache{cap: capacity, ll: list.New(), m: map[string]*list.Element{}}
}

func (c *iatCache) get(sub string) (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.m[sub]; ok {
		c.ll.MoveToFront(e)
		return e.Value.(*iatEntry).iat, true
	}
	return time.Time{}, false
}

func (c *iatCache) put(sub string, iat time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.m[sub]; ok {
		en := e.Value.(*iatEntry)
		if iat.After(en.iat) {
			en.iat = iat
		}
		c.ll.MoveToFront(e)
		return
	}
	c.m[sub] = c.ll.PushFront(&iatEntry{sub, iat})
	if c.ll.Len() > c.cap {
		old := c.ll.Back()
		c.ll.Remove(old)
		delete(c.m, old.Value.(*iatEntry).sub)
	}
}
