package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// NextBatchNumber atomically allocates the team-scoped batch number.
func (s *Store) NextBatchNumber(ctx context.Context, teamID bson.ObjectID) (int, error) {
	var t struct {
		Counter int `bson:"batchCounter"`
	}
	err := s.c("teams").FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: teamID}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "batchCounter", Value: 1}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&t)
	if err != nil {
		return 0, mapErr(err)
	}
	return t.Counter, nil
}

func (s *Store) InsertBatch(ctx context.Context, b *domain.Batch) error {
	now := time.Now().UTC()
	b.CreatedAt, b.UpdatedAt, b.StatusChangedAt, b.Version = now, now, now, 1
	ensureAssignments(&b.Assignments)
	res, err := s.c("batches").InsertOne(ctx, b)
	if err != nil {
		return mapErr(err)
	}
	b.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

// ensureAssignments avoids storing null arrays.
func ensureAssignments(a *domain.Assignments) {
	if a.Approvers == nil {
		a.Approvers = []bson.ObjectID{}
	}
	if a.Purchasers == nil {
		a.Purchasers = []bson.ObjectID{}
	}
}

func (s *Store) GetBatch(ctx context.Context, id bson.ObjectID) (*domain.Batch, error) {
	var b domain.Batch
	if err := s.c("batches").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&b); err != nil {
		return nil, mapErr(err)
	}
	return &b, nil
}

// BatchFilter narrows ListBatches. Zero values mean "any".
type BatchFilter struct {
	TeamID bson.ObjectID
	Status domain.BatchStatus
	Query  string // case-insensitive title substring
	// After is an exclusive cursor: only batches with _id < After are returned.
	After bson.ObjectID
}

// ListBatches returns batches newest first (by _id).
func (s *Store) ListBatches(ctx context.Context, f BatchFilter, limit int64) ([]domain.Batch, error) {
	q := bson.D{}
	if !f.TeamID.IsZero() {
		q = append(q, bson.E{Key: "teamId", Value: f.TeamID})
	}
	if f.Status != "" {
		q = append(q, bson.E{Key: "status", Value: f.Status})
	}
	if f.Query != "" {
		q = append(q, bson.E{Key: "title", Value: bson.Regex{Pattern: regexpQuote(f.Query), Options: "i"}})
	}
	if !f.After.IsZero() {
		q = append(q, bson.E{Key: "_id", Value: bson.D{{Key: "$lt", Value: f.After}}})
	}
	cur, err := s.c("batches").Find(ctx, q, options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.Batch
	return out, cur.All(ctx, &out)
}

// SetBatchStatus changes status and related fields under a version check.
func (s *Store) UpdateBatch(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Batch, error) {
	var out domain.Batch
	if err := s.UpdateVersioned(ctx, "batches", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- items ----

// NextItemSeq atomically allocates the per-batch item sequence number.
func (s *Store) NextItemSeq(ctx context.Context, batchID bson.ObjectID) (int, error) {
	var b struct {
		Counter int `bson:"itemCounter"`
	}
	err := s.c("batches").FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: batchID}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "itemCounter", Value: 1}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&b)
	if err != nil {
		return 0, mapErr(err)
	}
	return b.Counter, nil
}

func (s *Store) InsertItem(ctx context.Context, it *domain.Item) error {
	now := time.Now().UTC()
	it.CreatedAt, it.UpdatedAt, it.Version = now, now, 1
	if it.CustomFields == nil {
		it.CustomFields = map[string]any{}
	}
	res, err := s.c("items").InsertOne(ctx, it)
	if err != nil {
		return mapErr(err)
	}
	it.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetItem(ctx context.Context, id bson.ObjectID) (*domain.Item, error) {
	var it domain.Item
	if err := s.c("items").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&it); err != nil {
		return nil, mapErr(err)
	}
	return &it, nil
}

func (s *Store) ListItems(ctx context.Context, batchID bson.ObjectID) ([]domain.Item, error) {
	cur, err := s.c("items").Find(ctx, bson.D{{Key: "batchId", Value: batchID}},
		options.Find().SetSort(bson.D{{Key: "seqNo", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Item
	return out, cur.All(ctx, &out)
}

func (s *Store) UpdateItem(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Item, error) {
	var out domain.Item
	if err := s.UpdateVersioned(ctx, "items", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ItemCounts counts a batch's items by status, excluding withdrawn ones
// (withdrawn items are ignored by every "all items" condition, spec §10.1).
func (s *Store) ItemCounts(ctx context.Context, batchID bson.ObjectID) (domain.ItemCounts, error) {
	cur, err := s.c("items").Aggregate(ctx, bson.A{
		bson.D{{Key: "$match", Value: bson.D{
			{Key: "batchId", Value: batchID},
			{Key: "status", Value: bson.D{{Key: "$ne", Value: domain.ItemWithdrawn}}},
		}}},
		bson.D{{Key: "$group", Value: bson.D{{Key: "_id", Value: "$status"}, {Key: "n", Value: bson.D{{Key: "$sum", Value: 1}}}}}},
	})
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Status domain.ItemStatus `bson:"_id"`
		N      int               `bson:"n"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	counts := domain.ItemCounts{}
	for _, r := range rows {
		counts[r.Status] = r.N
	}
	return counts, nil
}

// RemoveAssignee removes a user from the approver assignments of every batch in a
// team (used when a member leaves, spec §8.1). Purchaser assignments are global
// and stay. It returns the affected batches.
func (s *Store) RemoveAssignee(ctx context.Context, teamID, userID bson.ObjectID) ([]bson.ObjectID, error) {
	filter := bson.D{{Key: "teamId", Value: teamID}, {Key: "$or", Value: bson.A{
		bson.D{{Key: "assignments.approvers", Value: userID}},
	}}}
	cur, err := s.c("batches").Find(ctx, filter, options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	_, err = s.c("batches").UpdateMany(ctx, filter, bson.D{
		{Key: "$pull", Value: bson.D{
			{Key: "assignments.approvers", Value: userID},
		}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
		{Key: "$set", Value: bson.D{{Key: "updatedAt", Value: time.Now().UTC()}}},
	})
	ids := make([]bson.ObjectID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	return ids, err
}

// BatchesByStatus lists batches in a status, optionally limited to teams
// (nil teamIDs means all teams).
func (s *Store) BatchesByStatus(ctx context.Context, status domain.BatchStatus, teamIDs []bson.ObjectID) ([]domain.Batch, error) {
	q := bson.D{{Key: "status", Value: status}}
	if teamIDs != nil {
		q = append(q, bson.E{Key: "teamId", Value: bson.D{{Key: "$in", Value: teamIDs}}})
	}
	cur, err := s.c("batches").Find(ctx, q, options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(500))
	if err != nil {
		return nil, err
	}
	var out []domain.Batch
	return out, cur.All(ctx, &out)
}

// BatchesByIDs fetches batches by id.
func (s *Store) BatchesByIDs(ctx context.Context, ids []bson.ObjectID) ([]domain.Batch, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := s.c("batches").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var out []domain.Batch
	return out, cur.All(ctx, &out)
}

// ItemsByRequester lists a user's items in a given status.
func (s *Store) ItemsByRequester(ctx context.Context, userID bson.ObjectID, status domain.ItemStatus) ([]domain.Item, error) {
	cur, err := s.c("items").Find(ctx, bson.D{{Key: "requesterId", Value: userID}, {Key: "status", Value: status}},
		options.Find().SetLimit(500))
	if err != nil {
		return nil, err
	}
	var out []domain.Item
	return out, cur.All(ctx, &out)
}

// BumpBatch increments the batch version without changing anything else. Review
// actions use it inside their transaction so they conflict with confirm_review
// (spec §10 intro).
func (s *Store) BumpBatch(ctx context.Context, id bson.ObjectID) error {
	res, err := s.c("batches").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, bson.D{
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
		{Key: "$set", Value: bson.D{{Key: "updatedAt", Value: time.Now().UTC()}}},
	})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// ItemsByBatchStatus lists a batch's items with a review status.
func (s *Store) ItemsByBatchStatus(ctx context.Context, batchID bson.ObjectID, status domain.ItemStatus) ([]domain.Item, error) {
	cur, err := s.c("items").Find(ctx, bson.D{{Key: "batchId", Value: batchID}, {Key: "status", Value: status}},
		options.Find().SetSort(bson.D{{Key: "seqNo", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Item
	return out, cur.All(ctx, &out)
}

// EventRecord is one domain event for the notification pipeline (spec §12.2).
// Delivery is M6; until then the outbox only accumulates.
type EventRecord struct {
	ID       bson.ObjectID `bson:"_id,omitempty"`
	At       time.Time     `bson:"at"`
	Type     string        `bson:"type"` // e.g. batch.review_confirmed, item.ordered.undone
	Actor    string        `bson:"actor"`
	TeamID   bson.ObjectID `bson:"teamId,omitempty"`
	BatchID  bson.ObjectID `bson:"batchId,omitempty"`
	ObjectID string        `bson:"objectId"`
	Undone   bool          `bson:"undone"`
}

// Emit appends an event to the outbox; call it inside the state change's transaction.
func (s *Store) Emit(ctx context.Context, e EventRecord) error {
	e.At = time.Now().UTC()
	_, err := s.c("eventOutbox").InsertOne(ctx, e)
	return err
}

// ItemsToPurchase lists approved items with remaining quantity in review-confirmed
// batches that are not purchased outside (the purchasing queue, spec §16.2).
func (s *Store) ItemsToPurchase(ctx context.Context) ([]domain.Item, error) {
	cur, err := s.c("items").Find(ctx, bson.D{
		{Key: "status", Value: domain.ItemApproved}, {Key: "toPurchaseQuantity", Value: bson.D{{Key: "$gt", Value: 0}}},
	})
	if err != nil {
		return nil, err
	}
	var out []domain.Item
	return out, cur.All(ctx, &out)
}
