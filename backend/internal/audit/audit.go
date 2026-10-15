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

	"github.com/OWNER/procurement-hub/internal/domain"
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

// ForObject returns the timeline of one object, oldest first.
func (l *Log) ForObject(ctx context.Context, objectType, objectID string, limit int64) ([]domain.AuditEvent, error) {
	return l.find(ctx, bson.D{{Key: "objectType", Value: objectType}, {Key: "objectId", Value: objectID}}, limit, 1)
}

// ForBatch returns the timeline of a batch including its items' events, oldest first.
func (l *Log) ForBatch(ctx context.Context, batchID bson.ObjectID, limit int64) ([]domain.AuditEvent, error) {
	return l.find(ctx, bson.D{{Key: "batchId", Value: batchID}}, limit, 1)
}

// ForTeam returns recent team audit events, newest first.
func (l *Log) ForTeam(ctx context.Context, teamID bson.ObjectID, limit int64) ([]domain.AuditEvent, error) {
	return l.find(ctx, bson.D{{Key: "teamId", Value: teamID}}, limit, -1)
}

func (l *Log) find(ctx context.Context, filter bson.D, limit int64, order int) ([]domain.AuditEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	cur, err := l.coll.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "at", Value: order}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.AuditEvent
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}
