package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/authz"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
)

type Timeline struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
	items   *Items
}

func NewTimeline(st *store.Store, a *audit.Log, b *Batches, i *Items) *Timeline {
	return &Timeline{st: st, audit: a, batches: b, items: i}
}

// ForBatch returns the batch timeline, including its items' events, to anyone
// who can read the batch (spec §8.3).
func (s *Timeline) ForBatch(ctx context.Context, actor authz.Actor, batchID bson.ObjectID) ([]domain.AuditEvent, error) {
	if _, _, err := s.batches.load(ctx, actor, batchID); err != nil {
		return nil, err
	}
	return s.audit.ForBatch(ctx, batchID, 500)
}

// ForItem returns an item's timeline.
func (s *Timeline) ForItem(ctx context.Context, actor authz.Actor, itemID bson.ObjectID) ([]domain.AuditEvent, error) {
	if _, _, _, err := s.items.loadItem(ctx, actor, itemID); err != nil {
		return nil, err
	}
	return s.audit.ForObject(ctx, "item", itemID.Hex(), 500)
}

// ForTeam returns the team-wide audit log: team admins and system admins only.
func (s *Timeline) ForTeam(ctx context.Context, actor authz.Actor, teamID bson.ObjectID) ([]domain.AuditEvent, error) {
	if !actor.CanAdminTeam(teamID) {
		return nil, ErrForbidden
	}
	return s.audit.ForTeam(ctx, teamID, 500)
}
