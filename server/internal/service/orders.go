package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Orders implements team orders (spec §10.3): the purchaser of a batch in
// `ordering` groups approved items into per-vendor draft orders.
type Orders struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
}

func NewOrders(st *store.Store, a *audit.Log, b *Batches) *Orders {
	return &Orders{st: st, audit: a, batches: b}
}

const maxVendorLen = 200

func orderEvent(actor string, b *domain.Batch, o *domain.Order, action string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{
		Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectType: "order", ObjectID: o.ID.Hex(),
		Action: action, Changes: changes,
	}
}

func itemEvent(actor string, b *domain.Batch, it *domain.Item, action, comment string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{
		Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectType: "item", ObjectID: it.ID.Hex(),
		Action: action, Comment: comment, Changes: changes,
	}
}

func hexIDs(ids []bson.ObjectID) string {
	s := make([]string, len(ids))
	for i, id := range ids {
		s[i] = id.Hex()
	}
	return strings.Join(s, ",")
}

func validVendor(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" || utf8.RuneCountInString(v) > maxVendorLen {
		return "", Invalid("vendor", "required, at most 200 characters")
	}
	return v, nil
}

func uniqueIDs(field string, ids []bson.ObjectID, max int) error {
	if len(ids) == 0 || len(ids) > max {
		return Invalid(field, "between 1 and "+itoa(max)+" ids are required")
	}
	seen := map[bson.ObjectID]bool{}
	for _, id := range ids {
		if seen[id] {
			return Invalid(field, "duplicate id "+id.Hex())
		}
		seen[id] = true
	}
	return nil
}

// loadOrder fetches an order with its batch and team and checks read access
// (404 when the batch is invisible).
func (s *Orders) loadOrder(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Order, *domain.Batch, *domain.Team, error) {
	o, err := s.st.GetOrder(ctx, id)
	if err != nil {
		return nil, nil, nil, mapStore(err)
	}
	b, t, err := s.batches.load(ctx, actor, o.BatchID)
	if err != nil {
		return nil, nil, nil, err
	}
	return o, b, t, nil
}

// List returns all orders of a batch (cancelled ones included) to anyone who
// can read the batch.
func (s *Orders) List(ctx context.Context, actor authz.Actor, batchID bson.ObjectID) ([]domain.Order, error) {
	if _, _, err := s.batches.load(ctx, actor, batchID); err != nil {
		return nil, err
	}
	orders, err := s.st.ListOrders(ctx, batchID)
	if orders == nil {
		orders = []domain.Order{}
	}
	return orders, err
}

type CreateOrderInput struct {
	Vendor  string
	ItemIDs []bson.ObjectID
}

// Create makes a draft order of approved items (purchasers, batch `ordering`).
func (s *Orders) Create(ctx context.Context, actor authz.Actor, batchID bson.ObjectID, in CreateOrderInput) (*domain.Order, error) {
	b, t, err := s.batches.load(ctx, actor, batchID)
	if err != nil {
		return nil, err
	}
	if !actor.HasBatchRole(t.ID, authzAssignments(b.Assignments), authz.BatchPurchaser) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if b.Status != domain.BatchOrdering {
		return nil, Rule("batch_not_ordering", "Orders can only be created while the batch is in ordering.")
	}
	vendor, err := validVendor(in.Vendor)
	if err != nil {
		return nil, err
	}
	if err := uniqueIDs("itemIds", in.ItemIDs, MaxItemsPerBatch); err != nil {
		return nil, err
	}
	o := &domain.Order{
		TeamID: t.ID, BatchID: b.ID, Vendor: vendor, ItemIDs: in.ItemIDs, Status: domain.OrderDraft,
		CostsProvisional: true, CreatedBy: actor.UserID,
	}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		if err := s.checkOrderable(ctx, b.ID, in.ItemIDs); err != nil {
			return err
		}
		n, err := s.st.NextOrderNumber(ctx, b.ID)
		if err != nil {
			return mapStore(err)
		}
		o.Number = n
		if err := s.st.InsertOrder(ctx, o); err != nil {
			return err
		}
		if err := s.assign(ctx, b.ID, in.ItemIDs, o.ID); err != nil {
			return err
		}
		return s.audit.Record(ctx, orderEvent(actor.UserID.Hex(), b, o, "order.created",
			domain.AuditChange{Field: "status", From: "", To: string(o.Status)},
			domain.AuditChange{Field: "vendor", From: "", To: vendor},
			domain.AuditChange{Field: "itemIds", From: "", To: hexIDs(o.ItemIDs)}))
	})
	if err != nil {
		return nil, err
	}
	return o, nil
}

// checkOrderable verifies every id is an approved, unordered item of the batch.
func (s *Orders) checkOrderable(ctx context.Context, batchID bson.ObjectID, ids []bson.ObjectID) error {
	items, err := s.st.ItemsByIDs(ctx, ids)
	if err != nil {
		return err
	}
	byID := make(map[bson.ObjectID]domain.Item, len(items))
	for _, it := range items {
		byID[it.ID] = it
	}
	for _, id := range ids {
		it, ok := byID[id]
		if !ok || it.BatchID != batchID {
			return Invalid("itemIds", id.Hex()+" is not an item of this batch")
		}
		if it.Status != domain.ItemApproved || it.OrderID != nil {
			return Rule("item_not_orderable", "Item #%d must be approved and not yet in an order.", it.SeqNo)
		}
	}
	return nil
}

func (s *Orders) assign(ctx context.Context, batchID bson.ObjectID, ids []bson.ObjectID, orderID bson.ObjectID) error {
	if len(ids) == 0 {
		return nil
	}
	n, err := s.st.AssignItemsToOrder(ctx, batchID, ids, orderID)
	if err != nil {
		return err
	}
	if int(n) != len(ids) { // a concurrent change took some of them
		return Rule("item_not_orderable", "Some items are no longer approved and available.")
	}
	return nil
}

// editable loads a draft order the actor may change.
func (s *Orders) editable(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Order, *domain.Batch, error) {
	o, b, t, err := s.loadOrder(ctx, actor, id)
	if err != nil {
		return nil, nil, err
	}
	if !actor.HasBatchRole(t.ID, authzAssignments(b.Assignments), authz.BatchPurchaser) {
		return nil, nil, ErrForbidden
	}
	if t.Archived {
		return nil, nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if o.Status != domain.OrderDraft {
		return nil, nil, Rule("order_not_draft", "Only draft orders can be changed.")
	}
	if o.VendorTransactionID != nil {
		return nil, nil, Rule("order_in_transaction", "Cancel the external order first to change this order.")
	}
	// While receiving, only edits that leave placed orders alone are possible.
	if b.Status != domain.BatchOrdering && b.Status != domain.BatchReceiving {
		return nil, nil, Rule("batch_not_ordering", "Orders can only be changed while the batch is ordering or receiving.")
	}
	return o, b, nil
}

type OrderPatch struct {
	Vendor  *string
	ItemIDs *[]bson.ObjectID // replaces the item set
}

// Update changes a draft order's vendor and/or item set.
func (s *Orders) Update(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, p OrderPatch) (*domain.Order, error) {
	o, b, err := s.editable(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	var set bson.D
	var changes []domain.AuditChange
	vendor := o.Vendor
	if p.Vendor != nil {
		if vendor, err = validVendor(*p.Vendor); err != nil {
			return nil, err
		}
		if vendor != o.Vendor {
			set = append(set, bson.E{Key: "vendor", Value: vendor})
			changes = append(changes, domain.AuditChange{Field: "vendor", From: o.Vendor, To: vendor})
		}
	}
	var added, removed []bson.ObjectID
	if p.ItemIDs != nil {
		if err := uniqueIDs("itemIds", *p.ItemIDs, MaxItemsPerBatch); err != nil {
			return nil, err
		}
		old, next := map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}
		for _, x := range o.ItemIDs {
			old[x] = true
		}
		for _, x := range *p.ItemIDs {
			next[x] = true
			if !old[x] {
				added = append(added, x)
			}
		}
		for _, x := range o.ItemIDs {
			if !next[x] {
				removed = append(removed, x)
			}
		}
		if len(added)+len(removed) > 0 {
			set = append(set, bson.E{Key: "itemIds", Value: *p.ItemIDs})
			changes = append(changes, domain.AuditChange{Field: "itemIds", From: hexIDs(o.ItemIDs), To: hexIDs(*p.ItemIDs)})
		}
	}
	if len(set) == 0 {
		if o.Version != version {
			return nil, ErrVersionConflict
		}
		return o, nil
	}
	var out *domain.Order
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		no, err := s.st.UpdateOrder(ctx, o.ID, version, set)
		if err != nil {
			return mapStore(err)
		}
		out = no
		if err := s.checkOrderable(ctx, b.ID, added); err != nil {
			return err
		}
		if err := s.assign(ctx, b.ID, added, o.ID); err != nil {
			return err
		}
		if _, err := s.st.ReleaseItemsFromOrder(ctx, removed, o.ID); err != nil {
			return err
		}
		return s.audit.Record(ctx, orderEvent(actor.UserID.Hex(), b, no, "order.updated", changes...))
	})
	return out, err
}

// Cancel withdraws a draft order and releases its items for other orders.
func (s *Orders) Cancel(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*domain.Order, error) {
	o, b, err := s.editable(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	var out *domain.Order
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		no, err := s.st.UpdateOrder(ctx, o.ID, version, bson.D{{Key: "status", Value: domain.OrderCancelled}})
		if err != nil {
			return mapStore(err)
		}
		out = no
		if _, err := s.st.ReleaseItemsFromOrder(ctx, o.ItemIDs, o.ID); err != nil {
			return err
		}
		return s.audit.Record(ctx, orderEvent(actor.UserID.Hex(), b, no, "order.cancelled",
			domain.AuditChange{Field: "status", From: string(o.Status), To: string(no.Status)}))
	})
	return out, err
}
