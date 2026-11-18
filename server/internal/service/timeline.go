package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

type Timeline struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
	items   *Items
	orders  *VendorOrders
}

func NewTimeline(st *store.Store, a *audit.Log, b *Batches, i *Items, o *VendorOrders) *Timeline {
	return &Timeline{st: st, audit: a, batches: b, items: i, orders: o}
}

// accountingActions are order-level money changes, summarised for regular users (spec §8.2).
var accountingActions = map[string]bool{
	"vendor_order.updated": true, "vendor_order.cost_entry_added": true, "vendor_order.cost_entry_updated": true, "vendor_order.cost_entry_deleted": true, "vendor_order.cost_entry_voided": true,
}

// visible filters a page of events to what the caller may read (spec §8.2):
// delivery events only for purchasers, receivers and system admins; vendor
// order events per line, with order-level money changes reduced to a summary.
func (s *Timeline) visible(ctx context.Context, actor authz.Actor, pg *audit.Page) *audit.Page {
	if privileged(actor) {
		return pg
	}
	acc := s.orders.access(ctx, actor)
	out := make([]domain.AuditEvent, 0, len(pg.Events))
	for _, ev := range pg.Events {
		switch ev.ObjectType {
		case "delivery", "problem":
			continue
		case "vendor_order":
			if ev.Scope == "line" {
				ok := false
				for _, t := range ev.TeamIDs {
					ok = ok || actor.IsMember(t)
				}
				if !ok && !ev.BatchID.IsZero() {
					ok = acc.canReadBatch(ev.BatchID)
				}
				if !ok {
					continue
				}
			} else if accountingActions[ev.Action] {
				ev.Changes = []domain.AuditChange{{Field: "accounting", From: nil, To: "updated"}}
				ev.Comment = ""
			}
		}
		out = append(out, ev)
	}
	pg.Events = out
	return pg
}

// ForBatch returns a page of the batch timeline, including its items' events,
// to anyone who can read the batch (spec §8.3).
func (s *Timeline) ForBatch(ctx context.Context, actor authz.Actor, batchID, after bson.ObjectID, limit int, newestFirst bool) (*audit.Page, error) {
	if _, _, err := s.batches.load(ctx, actor, batchID); err != nil {
		return nil, err
	}
	pg, err := s.audit.PageForBatch(ctx, batchID, after, limit, newestFirst)
	if err != nil {
		return nil, err
	}
	return s.visible(ctx, actor, pg), nil
}

// ForItem returns a page of an item's timeline.
func (s *Timeline) ForItem(ctx context.Context, actor authz.Actor, itemID, after bson.ObjectID, limit int, newestFirst bool) (*audit.Page, error) {
	if _, _, _, err := s.items.loadItem(ctx, actor, itemID); err != nil {
		return nil, err
	}
	return s.audit.PageForObject(ctx, "item", itemID.Hex(), after, limit, newestFirst)
}

// ForVendorOrder returns an order's timeline (lines, cost entries and problems
// included), filtered per line for regular users.
func (s *Timeline) ForVendorOrder(ctx context.Context, actor authz.Actor, id, after bson.ObjectID, limit int, newestFirst bool) (*audit.Page, error) {
	if _, err := s.orders.Get(ctx, actor, id); err != nil {
		return nil, err
	}
	pg, err := s.audit.PageForObject(ctx, "vendor_order", id.Hex(), after, limit, newestFirst)
	if err != nil {
		return nil, err
	}
	return s.visible(ctx, actor, pg), nil
}

// ForTeam returns a page of the team-wide audit log: team admins and system admins only.
func (s *Timeline) ForTeam(ctx context.Context, actor authz.Actor, teamID, after bson.ObjectID, limit int) (*audit.Page, error) {
	if !actor.CanAdminTeam(teamID) {
		return nil, ErrForbidden
	}
	pg, err := s.audit.PageForTeam(ctx, teamID, after, limit)
	if err != nil {
		return nil, err
	}
	return s.visible(ctx, actor, pg), nil
}

// ForDelivery returns a delivery's timeline (purchasers, receivers and system admins only).
func (s *Timeline) ForDelivery(ctx context.Context, actor authz.Actor, id, after bson.ObjectID, limit int, newestFirst bool) (*audit.Page, error) {
	if !privileged(actor) {
		return nil, ErrNotFound
	}
	if _, err := s.st.GetDelivery(ctx, id); err != nil {
		return nil, mapStore(err)
	}
	return s.audit.PageForObject(ctx, "delivery", id.Hex(), after, limit, newestFirst)
}
