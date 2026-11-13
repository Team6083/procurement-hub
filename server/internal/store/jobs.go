package store

import (
	"context"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func regexpQuote(s string) string { return regexp.QuoteMeta(s) }

// Job is a unit of scheduled background work (spec §13).
type Job struct {
	ID         bson.ObjectID `bson:"_id,omitempty"`
	Type       string        `bson:"type"`
	Key        string        `bson:"key"`
	RunAt      time.Time     `bson:"runAt"`
	LeaseOwner string        `bson:"leaseOwner,omitempty"`
	LeaseUntil time.Time     `bson:"leaseUntil,omitempty"`
	Attempts   int           `bson:"attempts"`
	Payload    bson.M        `bson:"payload"`
	Status     string        `bson:"status"` // pending | running | done
}

const (
	JobPending = "pending"
	JobRunning = "running"
	JobDone    = "done"
)

// UpsertJob creates or replaces the job with this key, so rescheduling
// replaces rather than duplicates.
func (s *Store) UpsertJob(ctx context.Context, key, typ string, runAt time.Time, payload bson.M) error {
	_, err := s.c("jobs").ReplaceOne(ctx, bson.D{{Key: "key", Value: key}}, Job{
		Type: typ, Key: key, RunAt: runAt.UTC(), Payload: payload, Status: JobPending,
	}, options.Replace().SetUpsert(true))
	return err
}

func (s *Store) DeleteJob(ctx context.Context, key string) error {
	_, err := s.c("jobs").DeleteOne(ctx, bson.D{{Key: "key", Value: key}})
	return err
}

// ClaimDueJob atomically claims one due job (pending, or running with an
// expired lease) for `lease`. It returns ErrNotFound when nothing is due.
func (s *Store) ClaimDueJob(ctx context.Context, owner string, now time.Time, lease time.Duration) (*Job, error) {
	var j Job
	err := s.c("jobs").FindOneAndUpdate(ctx,
		bson.D{{Key: "runAt", Value: bson.D{{Key: "$lte", Value: now}}}, {Key: "$or", Value: bson.A{
			bson.D{{Key: "status", Value: JobPending}},
			bson.D{{Key: "status", Value: JobRunning}, {Key: "leaseUntil", Value: bson.D{{Key: "$lt", Value: now}}}},
		}}},
		bson.D{
			{Key: "$set", Value: bson.D{{Key: "status", Value: JobRunning}, {Key: "leaseOwner", Value: owner}, {Key: "leaseUntil", Value: now.Add(lease)}}},
			{Key: "$inc", Value: bson.D{{Key: "attempts", Value: 1}}},
		},
		options.FindOneAndUpdate().SetSort(bson.D{{Key: "runAt", Value: 1}}).SetReturnDocument(options.After),
	).Decode(&j)
	if err != nil {
		return nil, mapErr(err)
	}
	return &j, nil
}

// RenewLease extends a held lease; false means the lease was lost.
func (s *Store) RenewLease(ctx context.Context, id bson.ObjectID, owner string, until time.Time) (bool, error) {
	res, err := s.c("jobs").UpdateOne(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "leaseOwner", Value: owner}, {Key: "status", Value: JobRunning}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "leaseUntil", Value: until}}}})
	return err == nil && res.MatchedCount == 1, err
}

// CompleteJob removes a finished one-shot job, but only if still held by owner
// (a rescheduled job with the same key was replaced and must not be deleted).
func (s *Store) CompleteJob(ctx context.Context, id bson.ObjectID, owner string) error {
	_, err := s.c("jobs").DeleteOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "leaseOwner", Value: owner}})
	return err
}

// ReleaseJob returns a failed job to pending to run again at retryAt.
func (s *Store) ReleaseJob(ctx context.Context, id bson.ObjectID, owner string, retryAt time.Time) error {
	_, err := s.c("jobs").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "leaseOwner", Value: owner}},
		bson.D{
			{Key: "$set", Value: bson.D{{Key: "status", Value: JobPending}, {Key: "runAt", Value: retryAt}}},
			{Key: "$unset", Value: bson.D{{Key: "leaseOwner", Value: ""}, {Key: "leaseUntil", Value: ""}}},
		})
	return err
}

// AbandonJob returns a job interrupted by shutdown to pending without delay
// and without counting the attempt, so another replica can take it at once.
func (s *Store) AbandonJob(ctx context.Context, id bson.ObjectID, owner string) error {
	_, err := s.c("jobs").UpdateOne(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "leaseOwner", Value: owner}, {Key: "status", Value: JobRunning}},
		bson.D{
			{Key: "$set", Value: bson.D{{Key: "status", Value: JobPending}}},
			{Key: "$unset", Value: bson.D{{Key: "leaseOwner", Value: ""}, {Key: "leaseUntil", Value: ""}}},
			{Key: "$inc", Value: bson.D{{Key: "attempts", Value: -1}}},
		})
	return err
}
