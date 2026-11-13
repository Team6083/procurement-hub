package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/store"
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

// ForBatch returns a page of the batch timeline, including its items' events,
// to anyone who can read the batch (spec §8.3).
func (s *Timeline) ForBatch(ctx context.Context, actor authz.Actor, batchID, after bson.ObjectID, limit int) (*audit.Page, error) {
	if _, _, err := s.batches.load(ctx, actor, batchID); err != nil {
		return nil, err
	}
	return s.audit.PageForBatch(ctx, batchID, after, limit)
}

// ForItem returns a page of an item's timeline.
func (s *Timeline) ForItem(ctx context.Context, actor authz.Actor, itemID, after bson.ObjectID, limit int) (*audit.Page, error) {
	if _, _, _, err := s.items.loadItem(ctx, actor, itemID); err != nil {
		return nil, err
	}
	return s.audit.PageForObject(ctx, "item", itemID.Hex(), after, limit)
}

// ForTeam returns a page of the team-wide audit log: team admins and system admins only.
func (s *Timeline) ForTeam(ctx context.Context, actor authz.Actor, teamID, after bson.ObjectID, limit int) (*audit.Page, error) {
	if !actor.CanAdminTeam(teamID) {
		return nil, ErrForbidden
	}
	return s.audit.PageForTeam(ctx, teamID, after, limit)
}
