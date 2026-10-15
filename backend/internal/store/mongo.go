// Package store holds MongoDB access: connection, replica-set check, indexes.
package store

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Store struct {
	Client *mongo.Client
	DB     *mongo.Database
}

// Connect opens the client, pings, and verifies the deployment is a replica
// set (multi-document transactions are required, spec §3).
func Connect(ctx context.Context, uri, database string) (*Store, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}
	s := &Store{Client: client, DB: client.Database(database)}
	if err := s.CheckReplicaSet(ctx); err != nil {
		_ = client.Disconnect(ctx)
		return nil, err
	}
	return s, nil
}

// CheckReplicaSet fails unless the server reports a replica set with a primary.
func (s *Store) CheckReplicaSet(ctx context.Context) error {
	var res struct {
		SetName    string `bson:"setName"`
		IsWritable bool   `bson:"isWritablePrimary"`
	}
	err := s.DB.RunCommand(ctx, bson.D{{Key: "hello", Value: 1}}).Decode(&res)
	if err != nil {
		return fmt.Errorf("mongo hello: %w", err)
	}
	if res.SetName == "" {
		return errors.New("MongoDB is not running as a replica set (required for transactions)")
	}
	if !res.IsWritable {
		return errors.New("MongoDB replica set has no writable primary")
	}
	return nil
}

func (s *Store) Close(ctx context.Context) error { return s.Client.Disconnect(ctx) }

// WithTx runs fn inside a transaction, retrying on transient errors.
func (s *Store) WithTx(ctx context.Context, fn func(ctx context.Context) error) error {
	sess, err := s.Client.StartSession()
	if err != nil {
		return err
	}
	defer sess.EndSession(ctx)
	_, err = sess.WithTransaction(ctx, func(sc context.Context) (any, error) {
		return nil, fn(sc)
	})
	return err
}

type indexSpec struct {
	coll   string
	keys   bson.D
	unique bool
	ttl    *int32
}

func asc(fields ...string) bson.D {
	d := bson.D{}
	for _, f := range fields {
		d = append(d, bson.E{Key: f, Value: 1})
	}
	return d
}

// EnsureIndexes creates all indexes from spec §9.2. It is idempotent.
func (s *Store) EnsureIndexes(ctx context.Context) error {
	specs := []indexSpec{
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
	for _, sp := range specs {
		opts := options.Index().SetUnique(sp.unique)
		_, err := s.DB.Collection(sp.coll).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: sp.keys, Options: opts})
		if err != nil {
			return fmt.Errorf("index on %s: %w", sp.coll, err)
		}
	}
	// In-app notifications: TTL on a dedicated field set when read (180 days).
	_, err := s.DB.Collection("notifications").Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "readAt", Value: 1}},
		Options: options.Index().SetExpireAfterSeconds(180 * 24 * 3600).SetName("readAt_ttl"),
	})
	if err != nil {
		return fmt.Errorf("notifications ttl index: %w", err)
	}
	return nil
}
