// Package audit writes and reads the append-only audit log.
//
// By design this package exposes no update or delete operation (spec §9.1).
package audit

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

const collection = "auditEvents"

type Log struct{ coll *mongo.Collection }

func New(db *mongo.Database) *Log { return &Log{coll: db.Collection(collection)} }

// SystemActor builds the actor string for background actors.
func SystemActor(job string) string { return "system:" + job }

// Record appends events. Pass a transaction context to make it atomic with
// the state change it describes.
func (l *Log) Record(ctx context.Context, events ...domain.AuditEvent) error {
	if len(events) == 0 {
		return nil
	}
	docs := make([]any, len(events))
	now := time.Now().UTC()
	for i, e := range events {
		if e.At.IsZero() {
			e.At = now
		}
		docs[i] = e
	}
	_, err := l.coll.InsertMany(ctx, docs)
	return err
}

// Page is one page of audit events plus the cursor for the next page (nil at the end).
type Page struct {
	Events     []domain.AuditEvent
	NextCursor *bson.ObjectID
}

// PageForObject returns an object's timeline, oldest first.
func (l *Log) PageForObject(ctx context.Context, objectType, objectID string, after bson.ObjectID, limit int) (*Page, error) {
	return l.page(ctx, bson.D{{Key: "objectType", Value: objectType}, {Key: "objectId", Value: objectID}}, after, limit, 1)
}

// PageForBatch returns a batch's timeline including its items' events, oldest first.
func (l *Log) PageForBatch(ctx context.Context, batchID bson.ObjectID, after bson.ObjectID, limit int) (*Page, error) {
	return l.page(ctx, bson.D{{Key: "batchId", Value: batchID}}, after, limit, 1)
}

// PageForTeam returns the team-wide log, newest first.
func (l *Log) PageForTeam(ctx context.Context, teamID bson.ObjectID, after bson.ObjectID, limit int) (*Page, error) {
	return l.page(ctx, bson.D{{Key: "teamIds", Value: teamID}}, after, limit, -1)
}

// page orders by _id (insertion order) so the cursor — the _id of the last
// returned event — is stable even when timestamps tie.
func (l *Log) page(ctx context.Context, filter bson.D, after bson.ObjectID, limit, order int) (*Page, error) {
	if limit < 1 {
		limit = 50
	}
	if !after.IsZero() {
		op := "$gt"
		if order < 0 {
			op = "$lt"
		}
		filter = append(filter, bson.E{Key: "_id", Value: bson.D{{Key: op, Value: after}}})
	}
	cur, err := l.coll.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: order}}).SetLimit(int64(limit)+1))
	if err != nil {
		return nil, err
	}
	var evs []domain.AuditEvent
	if err := cur.All(ctx, &evs); err != nil {
		return nil, err
	}
	pg := &Page{Events: evs}
	if len(evs) > limit {
		pg.Events = evs[:limit]
		last := pg.Events[limit-1].ID
		pg.NextCursor = &last
	}
	if pg.Events == nil {
		pg.Events = []domain.AuditEvent{}
	}
	return pg, nil
}
