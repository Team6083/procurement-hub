package store

import (
	"context"
	"time"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// ---- orders ----

// NextOrderNumber atomically allocates the per-batch order number.
func (s *Store) NextOrderNumber(ctx context.Context, batchID bson.ObjectID) (int, error) {
	var b struct {
		Counter int `bson:"orderCounter"`
	}
	err := s.c("batches").FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: batchID}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "orderCounter", Value: 1}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&b)
	if err != nil {
		return 0, mapErr(err)
	}
	return b.Counter, nil
}

func (s *Store) InsertOrder(ctx context.Context, o *domain.Order) error {
	now := time.Now().UTC()
	o.CreatedAt, o.UpdatedAt, o.Version = now, now, 1
	if o.ItemIDs == nil {
		o.ItemIDs = []bson.ObjectID{}
	}
	res, err := s.c("orders").InsertOne(ctx, o)
	if err != nil {
		return mapErr(err)
	}
	o.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetOrder(ctx context.Context, id bson.ObjectID) (*domain.Order, error) {
	var o domain.Order
	if err := s.c("orders").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&o); err != nil {
		return nil, mapErr(err)
	}
	return &o, nil
}

// ListOrders returns a batch's orders (cancelled ones included) by number.
func (s *Store) ListOrders(ctx context.Context, batchID bson.ObjectID) ([]domain.Order, error) {
	cur, err := s.c("orders").Find(ctx, bson.D{{Key: "batchId", Value: batchID}},
		options.Find().SetSort(bson.D{{Key: "number", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Order
	return out, cur.All(ctx, &out)
}

// OrdersByIDs fetches orders by id, in no particular order.
func (s *Store) OrdersByIDs(ctx context.Context, ids []bson.ObjectID) ([]domain.Order, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := s.c("orders").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []domain.Order
	return out, cur.All(ctx, &out)
}

func (s *Store) UpdateOrder(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Order, error) {
	var out domain.Order
	if err := s.UpdateVersioned(ctx, "orders", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// applyFields sets fields and bumps the version without a version check. It
// is for writes derived inside a transaction from documents read in the same
// transaction (cost recalculation, status changes caused by another document).
func (s *Store) applyFields(ctx context.Context, coll string, id bson.ObjectID, set bson.D) error {
	set = append(set, bson.E{Key: "updatedAt", Value: time.Now().UTC()})
	res, err := s.c(coll).UpdateOne(ctx, bson.D{{Key: "_id", Value: id}},
		bson.D{{Key: "$set", Value: set}, {Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ApplyOrderFields(ctx context.Context, id bson.ObjectID, set bson.D) error {
	return s.applyFields(ctx, "orders", id, set)
}

func (s *Store) ApplyItemFields(ctx context.Context, id bson.ObjectID, set bson.D) error {
	return s.applyFields(ctx, "items", id, set)
}

// ItemsByIDs fetches items by id, in no particular order.
func (s *Store) ItemsByIDs(ctx context.Context, ids []bson.ObjectID) ([]domain.Item, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := s.c("items").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []domain.Item
	return out, cur.All(ctx, &out)
}

// AssignItemsToOrder points approved, still unordered items of a batch at an
// order. It returns how many items matched; a count below len(ids) means a
// concurrent change took some of them.
func (s *Store) AssignItemsToOrder(ctx context.Context, batchID bson.ObjectID, ids []bson.ObjectID, orderID bson.ObjectID) (int64, error) {
	res, err := s.c("items").UpdateMany(ctx, bson.D{
		{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}},
		{Key: "batchId", Value: batchID},
		{Key: "status", Value: domain.ItemApproved},
		{Key: "orderId", Value: nil},
	}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "orderId", Value: orderID}, {Key: "updatedAt", Value: time.Now().UTC()}}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
	})
	if err != nil {
		return 0, err
	}
	return res.MatchedCount, nil
}

// ReleaseItemsFromOrder clears the order of items that belong to it and
// resets their actual prices (they only make sense inside an external order).
func (s *Store) ReleaseItemsFromOrder(ctx context.Context, ids []bson.ObjectID, orderID bson.ObjectID) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	res, err := s.c("items").UpdateMany(ctx, bson.D{
		{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}},
		{Key: "orderId", Value: orderID},
	}, bson.D{
		{Key: "$set", Value: bson.D{
			{Key: "orderId", Value: nil}, {Key: "actualUnitPrice", Value: nil}, {Key: "actualCostBase", Value: nil},
			{Key: "updatedAt", Value: time.Now().UTC()},
		}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
	})
	if err != nil {
		return 0, err
	}
	return res.MatchedCount, nil
}

// AttachOrdersToTransaction links draft, unattached orders to a vendor
// transaction and returns how many matched.
func (s *Store) AttachOrdersToTransaction(ctx context.Context, ids []bson.ObjectID, txID bson.ObjectID) (int64, error) {
	res, err := s.c("orders").UpdateMany(ctx, bson.D{
		{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}},
		{Key: "status", Value: domain.OrderDraft},
		{Key: "vendorTransactionId", Value: nil},
	}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "vendorTransactionId", Value: txID}, {Key: "updatedAt", Value: time.Now().UTC()}}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
	})
	if err != nil {
		return 0, err
	}
	return res.MatchedCount, nil
}

// ---- vendor transactions ----

func (s *Store) InsertVendorTransaction(ctx context.Context, v *domain.VendorTransaction) error {
	now := time.Now().UTC()
	v.CreatedAt, v.UpdatedAt, v.Version = now, now, 1
	if v.SharedCosts == nil {
		v.SharedCosts = []domain.SharedCost{}
	}
	if v.Allocations == nil {
		v.Allocations = []domain.Allocation{}
	}
	res, err := s.c("vendorTransactions").InsertOne(ctx, v)
	if err != nil {
		return mapErr(err)
	}
	v.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetVendorTransaction(ctx context.Context, id bson.ObjectID) (*domain.VendorTransaction, error) {
	var v domain.VendorTransaction
	if err := s.c("vendorTransactions").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&v); err != nil {
		return nil, mapErr(err)
	}
	return &v, nil
}

func (s *Store) UpdateVendorTransaction(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.VendorTransaction, error) {
	var out domain.VendorTransaction
	if err := s.UpdateVersioned(ctx, "vendorTransactions", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- adjustments ----

func (s *Store) InsertAdjustment(ctx context.Context, a *domain.Adjustment) error {
	now := time.Now().UTC()
	a.CreatedAt, a.UpdatedAt, a.Version = now, now, 1
	res, err := s.c("adjustments").InsertOne(ctx, a)
	if err != nil {
		return mapErr(err)
	}
	a.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

// AdjustmentTotals sums adjustments.amountBase per order (orders without any
// adjustment are absent from the map).
func (s *Store) AdjustmentTotals(ctx context.Context, orderIDs []bson.ObjectID) (map[bson.ObjectID]decimal.Decimal, error) {
	out := map[bson.ObjectID]decimal.Decimal{}
	if len(orderIDs) == 0 {
		return out, nil
	}
	cur, err := s.c("adjustments").Find(ctx, bson.D{{Key: "orderId", Value: bson.D{{Key: "$in", Value: orderIDs}}}})
	if err != nil {
		return nil, err
	}
	var rows []domain.Adjustment
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, a := range rows {
		out[a.OrderID] = out[a.OrderID].Add(a.AmountBase.Decimal)
	}
	return out, nil
}
