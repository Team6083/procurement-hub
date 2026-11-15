package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// ---- receipts ----

func (s *Store) InsertReceipt(ctx context.Context, r *domain.Receipt) error {
	now := time.Now().UTC()
	r.CreatedAt, r.UpdatedAt, r.Version = now, now, 1
	if r.Attachments == nil {
		r.Attachments = []string{} // reserved, always empty
	}
	res, err := s.c("receipts").InsertOne(ctx, r)
	if err != nil {
		return mapErr(err)
	}
	r.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

// ListReceipts returns an item's receiving records, oldest first.
func (s *Store) ListReceipts(ctx context.Context, itemID bson.ObjectID) ([]domain.Receipt, error) {
	cur, err := s.c("receipts").Find(ctx, bson.D{{Key: "itemId", Value: itemID}},
		options.Find().SetSort(bson.D{{Key: "receivedAt", Value: 1}, {Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Receipt
	return out, cur.All(ctx, &out)
}

// ---- exceptions ----

func (s *Store) InsertException(ctx context.Context, e *domain.Exception) error {
	now := time.Now().UTC()
	e.CreatedAt, e.UpdatedAt, e.Version = now, now, 1
	res, err := s.c("itemExceptions").InsertOne(ctx, e)
	if err != nil {
		return mapErr(err)
	}
	e.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetException(ctx context.Context, id bson.ObjectID) (*domain.Exception, error) {
	var e domain.Exception
	if err := s.c("itemExceptions").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&e); err != nil {
		return nil, mapErr(err)
	}
	return &e, nil
}

// ListExceptions returns an item's exceptions, oldest first.
func (s *Store) ListExceptions(ctx context.Context, itemID bson.ObjectID) ([]domain.Exception, error) {
	cur, err := s.c("itemExceptions").Find(ctx, bson.D{{Key: "itemId", Value: itemID}},
		options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Exception
	return out, cur.All(ctx, &out)
}

// UpdateException applies `set` under a version check.
func (s *Store) UpdateException(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Exception, error) {
	var out domain.Exception
	if err := s.UpdateVersioned(ctx, "itemExceptions", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
