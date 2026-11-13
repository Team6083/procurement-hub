// Package migrations holds the versioned data migrations (spec §13.2),
// including index creation. `procurement-hub migrate` applies them; `serve`
// only checks that they have all been applied.
package migrations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/store"
)

// Migration is one versioned, idempotent change. Up must be safe to run again
// after it failed part-way: running it twice gives the same result as once.
type Migration struct {
	ID string // "NNNN_snake_case", strictly increasing in registration order
	Up func(ctx context.Context, db *mongo.Database) error
}

// registry lists every migration in the order it must run. Append only.
var registry = []Migration{
	{ID: "0001_reference_rates_decimal", Up: referenceRatesDecimal},
}

// All returns the registered migrations in order.
func All() []Migration { return append([]Migration(nil), registry...) }

const (
	recordsColl = "migrations"
	leaseColl   = "migrationLease"
	leaseID     = "migrate"
)

// Validate reports registration mistakes: empty or non-increasing ids, or a
// missing Up function.
func Validate(ms []Migration) error {
	prev := ""
	for i, m := range ms {
		if m.ID == "" || m.Up == nil {
			return fmt.Errorf("migration #%d: id and Up are required", i)
		}
		if m.ID <= prev {
			return fmt.Errorf("migration %q is not after %q", m.ID, prev)
		}
		prev = m.ID
	}
	return nil
}

// Pending returns the ids of the given migrations that the database has not
// recorded, in order. Records of unknown ids (from a newer build) are ignored.
func Pending(ctx context.Context, db *mongo.Database, ms []Migration) ([]string, error) {
	ids := make([]string, len(ms))
	for i, m := range ms {
		ids[i] = m.ID
	}
	cur, err := db.Collection(recordsColl).Find(ctx,
		bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("read migration records: %w", err)
	}
	var recs []struct {
		ID string `bson:"_id"`
	}
	if err := cur.All(ctx, &recs); err != nil {
		return nil, fmt.Errorf("read migration records: %w", err)
	}
	done := make(map[string]bool, len(recs))
	for _, r := range recs {
		done[r.ID] = true
	}
	var pending []string
	for _, id := range ids {
		if !done[id] {
			pending = append(pending, id)
		}
	}
	return pending, nil
}

// Error names the migration that failed.
type Error struct {
	ID  string
	Err error
}

func (e *Error) Error() string { return fmt.Sprintf("migration %s failed: %v", e.ID, e.Err) }
func (e *Error) Unwrap() error { return e.Err }

// Runner applies migrations under a MongoDB lease so only one runs at a time.
type Runner struct {
	DB         *mongo.Database
	Migrations []Migration // nil means All()
	Owner      string      // lease holder identity, e.g. host-pid
	AppVersion string      // written to each record
	Logger     *slog.Logger
	// Lease is how long the lease lasts without renewal (default 60s); it is
	// renewed every Lease/3 while migrations run. A crashed holder's lease
	// expires and the next migrate takes over.
	Lease time.Duration
	// PollInterval is how often a waiting migrate retries the lease (default 2s).
	PollInterval time.Duration
}

// NewRunner returns a Runner for the registered migrations.
func NewRunner(st *store.Store, owner, appVersion string) *Runner {
	return &Runner{DB: st.DB, Owner: owner, AppVersion: appVersion}
}

// Run waits for the lease, then applies every unapplied migration in order,
// recording each on success. It returns the ids applied by this call; on
// failure the error is an *Error naming the migration.
func (r *Runner) Run(ctx context.Context) ([]string, error) {
	ms := r.Migrations
	if ms == nil {
		ms = registry
	}
	if err := Validate(ms); err != nil {
		return nil, err
	}
	log := r.Logger
	if log == nil {
		log = slog.Default()
	}
	lease := r.Lease
	if lease <= 0 {
		lease = 60 * time.Second
	}
	poll := r.PollInterval
	if poll <= 0 {
		poll = 2 * time.Second
	}

	// Losing the lease (renewal failed) cancels the work in progress so two
	// runs never apply migrations at the same time for long.
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	release, err := r.acquire(ctx, lease, poll, log, func() { cancel(errLeaseLost) })
	if err != nil {
		return nil, err
	}
	defer release()

	pending, err := Pending(ctx, r.DB, ms)
	if err != nil {
		return nil, err
	}
	todo := make(map[string]bool, len(pending))
	for _, id := range pending {
		todo[id] = true
	}
	var applied []string
	for _, m := range ms {
		if !todo[m.ID] {
			continue
		}
		if errors.Is(context.Cause(ctx), errLeaseLost) {
			return applied, &Error{ID: m.ID, Err: errLeaseLost}
		}
		log.Info("applying migration", "migration", m.ID)
		start := time.Now()
		if err := m.Up(ctx, r.DB); err != nil {
			return applied, &Error{ID: m.ID, Err: err}
		}
		if _, err := r.DB.Collection(recordsColl).UpdateOne(ctx,
			bson.D{{Key: "_id", Value: m.ID}},
			bson.D{{Key: "$setOnInsert", Value: bson.D{
				{Key: "appliedAt", Value: time.Now().UTC()}, {Key: "appVersion", Value: r.AppVersion},
			}}},
			options.UpdateOne().SetUpsert(true)); err != nil {
			return applied, &Error{ID: m.ID, Err: fmt.Errorf("record: %w", err)}
		}
		log.Info("applied migration", "migration", m.ID, "duration_ms", time.Since(start).Milliseconds())
		applied = append(applied, m.ID)
	}
	return applied, nil
}

var errLeaseLost = errors.New("migration lease lost")

// acquire takes the lease document, waiting while another live holder has
// it, and keeps renewing it in the background, calling onLost if renewal
// fails. release stops renewal and frees the lease.
func (r *Runner) acquire(ctx context.Context, lease, poll time.Duration, log *slog.Logger, onLost func()) (release func(), err error) {
	coll := r.DB.Collection(leaseColl)
	waiting := false
	for {
		now := time.Now().UTC()
		_, err := coll.UpdateOne(ctx,
			bson.D{{Key: "_id", Value: leaseID}, {Key: "$or", Value: bson.A{
				bson.D{{Key: "leaseUntil", Value: bson.D{{Key: "$lt", Value: now}}}},
				bson.D{{Key: "leaseOwner", Value: r.Owner}},
			}}},
			bson.D{{Key: "$set", Value: bson.D{{Key: "leaseOwner", Value: r.Owner}, {Key: "leaseUntil", Value: now.Add(lease)}}}},
			options.UpdateOne().SetUpsert(true))
		if err == nil {
			break
		}
		// A duplicate key means the document exists and a live holder has it.
		if !mongo.IsDuplicateKeyError(err) {
			return nil, fmt.Errorf("acquire migration lease: %w", err)
		}
		if !waiting {
			var cur struct {
				Owner string `bson:"leaseOwner"`
			}
			_ = coll.FindOne(ctx, bson.D{{Key: "_id", Value: leaseID}}).Decode(&cur)
			log.Info("waiting for migration lease", "holder", cur.Owner)
			waiting = true
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("acquire migration lease: %w", ctx.Err())
		case <-time.After(poll):
		}
	}

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		t := time.NewTicker(lease / 3)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				res, err := coll.UpdateOne(context.WithoutCancel(ctx),
					bson.D{{Key: "_id", Value: leaseID}, {Key: "leaseOwner", Value: r.Owner}},
					bson.D{{Key: "$set", Value: bson.D{{Key: "leaseUntil", Value: time.Now().UTC().Add(lease)}}}})
				if err != nil || res.MatchedCount != 1 {
					log.Error("migration lease lost", "error", err)
					onLost()
					return
				}
			}
		}
	}()
	release = func() {
		close(stop)
		<-done
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		_, _ = coll.DeleteOne(ctx, bson.D{{Key: "_id", Value: leaseID}, {Key: "leaseOwner", Value: r.Owner}})
	}
	return release, nil
}

// Check backs serve's "migrations" readiness check (spec §13.2, §18.2): it
// fails while any registered migration is unrecorded. Once everything has
// been seen applied it stops querying, since migrations are never undone.
type Check struct {
	db         *mongo.Database
	migrations []Migration
	ok         atomic.Bool
}

// NewCheck returns a Check for the registered migrations.
func NewCheck(db *mongo.Database) *Check { return &Check{db: db, migrations: registry} }

// Pending returns the unapplied migration ids.
func (c *Check) Pending(ctx context.Context) ([]string, error) {
	if c.ok.Load() {
		return nil, nil
	}
	p, err := Pending(ctx, c.db, c.migrations)
	if err == nil && len(p) == 0 {
		c.ok.Store(true)
	}
	return p, err
}

// Ready is an ops.CheckFunc.
func (c *Check) Ready(ctx context.Context) error {
	p, err := c.Pending(ctx)
	if err != nil {
		return err
	}
	if len(p) > 0 {
		return fmt.Errorf("pending migrations (run `procurement-hub migrate`): %s", strings.Join(p, ", "))
	}
	return nil
}
