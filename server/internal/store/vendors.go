package store

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

func (s *Store) InsertVendor(ctx context.Context, v *domain.Vendor) error {
	now := time.Now().UTC()
	v.CreatedAt, v.UpdatedAt, v.Version = now, now, 1
	res, err := s.c("vendors").InsertOne(ctx, v)
	if err != nil {
		return mapErr(err)
	}
	v.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetVendor(ctx context.Context, id bson.ObjectID) (*domain.Vendor, error) {
	var v domain.Vendor
	if err := s.c("vendors").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&v); err != nil {
		return nil, mapErr(err)
	}
	return &v, nil
}

// ListVendors returns vendors sorted by name; inactive ones only on request.
func (s *Store) ListVendors(ctx context.Context, includeInactive bool) ([]domain.Vendor, error) {
	f := bson.D{}
	if !includeInactive {
		f = bson.D{{Key: "active", Value: true}}
	}
	cur, err := s.c("vendors").Find(ctx, f, options.Find().SetSort(bson.D{{Key: "nameKey", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Vendor
	return out, cur.All(ctx, &out)
}

// VendorKeyOwner returns another vendor whose name or alias equals one of keys, if any.
func (s *Store) VendorKeyOwner(ctx context.Context, self bson.ObjectID, keys []string) (*domain.Vendor, error) {
	var v domain.Vendor
	err := s.c("vendors").FindOne(ctx, bson.D{
		{Key: "_id", Value: bson.D{{Key: "$ne", Value: self}}},
		{Key: "$or", Value: bson.A{
			bson.D{{Key: "nameKey", Value: bson.D{{Key: "$in", Value: keys}}}},
			bson.D{{Key: "aliasKeys", Value: bson.D{{Key: "$in", Value: keys}}}},
		}},
	}).Decode(&v)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Store) UpdateVendor(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Vendor, error) {
	var out domain.Vendor
	if err := s.UpdateVersioned(ctx, "vendors", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- reference rates ----

func (s *Store) ListRates(ctx context.Context) ([]domain.GlobalRate, error) {
	cur, err := s.c("referenceRates").Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.GlobalRate
	return out, cur.All(ctx, &out)
}

func (s *Store) GetRate(ctx context.Context, currency string) (*domain.GlobalRate, error) {
	var r domain.GlobalRate
	if err := s.c("referenceRates").FindOne(ctx, bson.D{{Key: "_id", Value: currency}}).Decode(&r); err != nil {
		return nil, mapErr(err)
	}
	return &r, nil
}

// InsertRate creates the currency's rate at version 1 (ErrDuplicate if it exists).
func (s *Store) InsertRate(ctx context.Context, r *domain.GlobalRate) error {
	r.UpdatedAt, r.Version = time.Now().UTC(), 1
	_, err := s.c("referenceRates").InsertOne(ctx, r)
	return mapErr(err)
}

// UpdateRate replaces the rate if its version matches.
func (s *Store) UpdateRate(ctx context.Context, currency string, version int64, rate domain.Decimal, by string) (*domain.GlobalRate, error) {
	var out domain.GlobalRate
	err := s.c("referenceRates").FindOneAndUpdate(ctx,
		bson.D{{Key: "_id", Value: currency}, {Key: "version", Value: version}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "rateToBase", Value: rate}, {Key: "updatedAt", Value: time.Now().UTC()}, {Key: "updatedBy", Value: by}}},
			{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		if _, gerr := s.GetRate(ctx, currency); gerr == nil {
			return nil, ErrVersionConflict
		}
		return nil, ErrNotFound
	}
	return &out, mapErr(err)
}

// DeleteRate removes the rate if its version matches.
func (s *Store) DeleteRate(ctx context.Context, currency string, version int64) error {
	res, err := s.c("referenceRates").DeleteOne(ctx, bson.D{{Key: "_id", Value: currency}, {Key: "version", Value: version}})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		if _, gerr := s.GetRate(ctx, currency); gerr == nil {
			return ErrVersionConflict
		}
		return ErrNotFound
	}
	return nil
}
