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
}

func asc(fields ...string) bson.D {
	d := bson.D{}
	for _, f := range fields {
		d = append(d, bson.E{Key: f, Value: 1})
	}
	return d
}

// indexes0001 are the indexes of spec §9.2 (the readAt TTL index is separate).
var indexes0001 = []indexSpec{
	{coll: "users", keys: asc("sub"), unique: true},
	{coll: "teams", keys: asc("slug"), unique: true},
	{coll: "memberships", keys: asc("teamId", "userId"), unique: true},
	{coll: "memberships", keys: asc("userId")},
	{coll: "batches", keys: asc("teamId", "status", "updatedAt")},
	{coll: "batches", keys: asc("teamId", "number"), unique: true},
	{coll: "items", keys: asc("batchId", "seqNo"), unique: true},
	{coll: "items", keys: asc("teamId", "status")},
	{coll: "items", keys: asc("requesterId")},
	{coll: "items", keys: asc("orderId")},
	{coll: "orders", keys: asc("batchId")},
	{coll: "orders", keys: asc("vendorTransactionId")},
	{coll: "vendorTransactions", keys: asc("teamIds")},
	{coll: "receipts", keys: asc("itemId")},
	{coll: "itemExceptions", keys: asc("itemId")},
	{coll: "auditEvents", keys: asc("objectType", "objectId", "at")},
	{coll: "auditEvents", keys: asc("teamId", "at")},
	{coll: "auditEvents", keys: asc("batchId", "at")},
	{coll: "notifications", keys: asc("userId", "readAt", "createdAt")},
	{coll: "outbox", keys: asc("status", "nextAttemptAt")},
	{coll: "jobs", keys: asc("status", "runAt")},
	{coll: "jobs", keys: asc("key"), unique: true},
}

// referenceRatesDecimal is 0001: create the §9.2 indexes and convert
// teams.referenceRates[].rateToBase from decimal strings to Decimal128.
// Both steps are idempotent: creating an existing identical index is a
// no-op, and the conversion only touches string values.
func referenceRatesDecimal(ctx context.Context, db *mongo.Database) error {
	for _, sp := range indexes0001 {
		_, err := db.Collection(sp.coll).Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: sp.keys, Options: options.Index().SetUnique(sp.unique),
		})
		if err != nil {
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

	// Each document is rewritten atomically by an update pipeline; elements
	// already holding Decimal128 are left as they are.
	isString := bson.D{{Key: "$eq", Value: bson.A{bson.D{{Key: "$type", Value: "$$r.rateToBase"}}, "string"}}}
	_, err = db.Collection("teams").UpdateMany(ctx,
		bson.D{{Key: "referenceRates.rateToBase", Value: bson.D{{Key: "$type", Value: "string"}}}},
		bson.A{bson.D{{Key: "$set", Value: bson.D{{Key: "referenceRates", Value: bson.D{{Key: "$map", Value: bson.D{
			{Key: "input", Value: "$referenceRates"},
			{Key: "as", Value: "r"},
			{Key: "in", Value: bson.D{{Key: "$mergeObjects", Value: bson.A{"$$r", bson.D{{Key: "rateToBase", Value: bson.D{
				{Key: "$cond", Value: bson.A{isString, bson.D{{Key: "$toDecimal", Value: "$$r.rateToBase"}}, "$$r.rateToBase"}},
			}}}}}}},
		}}}}}}}})
	if err != nil {
		return fmt.Errorf("convert teams.referenceRates.rateToBase: %w", err)
	}
	return nil
}
