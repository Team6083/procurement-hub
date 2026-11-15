package migrations

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// indexes0002 back milestone 4: per-batch order numbers must be unique, and
// an order's adjustments are looked up by order.
var indexes0002 = []indexSpec{
	{coll: "orders", keys: asc("batchId", "number"), unique: true},
	{coll: "adjustments", keys: asc("orderId")},
}

// orderIndexes is 0002. Creating an existing identical index is a no-op, so
// it is safe to run again after a failure.
func orderIndexes(ctx context.Context, db *mongo.Database) error {
	for _, sp := range indexes0002 {
		_, err := db.Collection(sp.coll).Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys: sp.keys, Options: options.Index().SetUnique(sp.unique),
		})
		if err != nil {
			return fmt.Errorf("index on %s: %w", sp.coll, err)
		}
	}
	return nil
}
