package migrations

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type indexSpec struct {
	coll   string
	keys   bson.D
	unique bool
	// partial restricts the index to documents where the field exists
	// (partial unique indexes for optional values, spec §9.2).
	partial string
}

func asc(fields ...string) bson.D {
	d := bson.D{}
	for _, f := range fields {
		d = append(d, bson.E{Key: f, Value: 1})
	}
	return d
}

// indexes0001 are the indexes of spec §9.2 (the readAt TTL index is separate).
// There is no data to convert (the project had no real data when the
// migrations were squashed), so this migration only creates indexes; each
// milestone adds its own indexes here.
var indexes0001 = []indexSpec{
	{coll: "users", keys: asc("sub"), unique: true},
	{coll: "users", keys: asc("roleSnapshot.purchaser")},
	{coll: "users", keys: asc("roleSnapshot.receiver")},
	{coll: "teams", keys: asc("slug"), unique: true},
	{coll: "vendors", keys: asc("nameKey"), unique: true},
	// Vendors without aliases omit the field, so they never collide here.
	{coll: "vendors", keys: asc("aliasKeys"), unique: true, partial: "aliasKeys"},
	{coll: "memberships", keys: asc("teamId", "userId"), unique: true},
	{coll: "memberships", keys: asc("userId")},
	{coll: "batches", keys: asc("teamId", "status", "updatedAt")},
	{coll: "batches", keys: asc("teamId", "number"), unique: true},
	{coll: "items", keys: asc("batchId", "seqNo"), unique: true},
	{coll: "items", keys: asc("teamId", "status")},
	{coll: "items", keys: asc("requesterId")},
	{coll: "items", keys: asc("toPurchaseQuantity", "vendorId")},
	{coll: "vendorOrders", keys: asc("number"), unique: true},
	{coll: "vendorOrders", keys: asc("status", "vendorId")},
	{coll: "vendorOrders", keys: asc("teamIds")},
	{coll: "vendorOrders", keys: asc("batchIds")},
	{coll: "vendorOrderLines", keys: asc("vendorOrderId")},
	{coll: "vendorOrderLines", keys: asc("itemId")},
	{coll: "vendorOrderLines", keys: asc("teamId", "status")},
	{coll: "costEntries", keys: asc("vendorOrderId")},
	{coll: "deliveries", keys: asc("number"), unique: true},
	{coll: "deliveries", keys: asc("receivedAt")},
	{coll: "deliveryLines", keys: asc("deliveryId")},
	{coll: "deliveryLines", keys: asc("matchState")},
	{coll: "deliveryMatches", keys: asc("deliveryLineId")},
	{coll: "deliveryMatches", keys: asc("vendorOrderLineId")},
	{coll: "lineProblems", keys: asc("vendorOrderLineId")},
	{coll: "lineProblems", keys: asc("deliveryMatchId")},
	{coll: "auditEvents", keys: asc("objectType", "objectId", "at")},
	{coll: "auditEvents", keys: asc("teamIds", "at")},
	{coll: "auditEvents", keys: asc("batchId", "at")},
	{coll: "notifications", keys: asc("userId", "readAt", "createdAt")},
	{coll: "outbox", keys: asc("status", "nextAttemptAt")},
	{coll: "jobs", keys: asc("status", "runAt")},
	{coll: "jobs", keys: asc("key"), unique: true},
}

// initial is 0001: create the indexes. Creating an existing identical index
// is a no-op, so it is safe to run again after a failure.
func initial(ctx context.Context, db *mongo.Database) error {
	for _, sp := range indexes0001 {
		opts := options.Index().SetUnique(sp.unique)
		if sp.partial != "" {
			opts.SetPartialFilterExpression(bson.D{{Key: sp.partial, Value: bson.D{{Key: "$exists", Value: true}}}})
		}
		if _, err := db.Collection(sp.coll).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: sp.keys, Options: opts}); err != nil {
			return fmt.Errorf("index on %s: %w", sp.coll, err)
		}
	}
	// In-app notifications: TTL on readAt, deleted 180 days after being read.
	_, err := db.Collection("notifications").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "readAt", Value: 1}},
		Options: options.Index().SetExpireAfterSeconds(180 * 24 * 3600).SetName("readAt_ttl"),
	})
	if err != nil {
		return fmt.Errorf("notifications ttl index: %w", err)
	}
	return nil
}
