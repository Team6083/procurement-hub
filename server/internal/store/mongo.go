// Package store holds MongoDB access: connection, replica-set check and
// repositories. Indexes are created by package migrations.
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
