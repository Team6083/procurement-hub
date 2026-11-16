package migrations_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/team6083/procurement-hub/server/internal/migrations"
	"github.com/team6083/procurement-hub/server/internal/mongotest"
	"github.com/team6083/procurement-hub/server/internal/ops"
)

func TestMain(m *testing.M) { os.Exit(mongotest.Main(m)) }

func TestValidate(t *testing.T) {
	up := func(context.Context, *mongo.Database) error { return nil }
	if err := migrations.Validate(migrations.All()); err != nil {
		t.Fatalf("registered migrations: %v", err)
	}
	for name, ms := range map[string][]migrations.Migration{
		"duplicate":  {{ID: "0001_a", Up: up}, {ID: "0001_a", Up: up}},
		"decreasing": {{ID: "0002_a", Up: up}, {ID: "0001_b", Up: up}},
		"no up":      {{ID: "0001_a"}},
		"no id":      {{Up: up}},
	} {
		if migrations.Validate(ms) == nil {
			t.Errorf("%s: Validate accepted %v", name, ms)
		}
	}
}

func recorded(t *testing.T, db *mongo.Database) map[string]bson.M {
	t.Helper()
	cur, err := db.Collection("migrations").Find(context.Background(), bson.D{})
	if err != nil {
		t.Fatal(err)
	}
	var docs []bson.M
	if err := cur.All(context.Background(), &docs); err != nil {
		t.Fatal(err)
	}
	out := map[string]bson.M{}
	for _, d := range docs {
		out[d["_id"].(string)] = d
	}
	return out
}

func indexNames(t *testing.T, db *mongo.Database, coll string) map[string]bool {
	t.Helper()
	specs, err := db.Collection(coll).Indexes().ListSpecifications(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, s := range specs {
		out[s.Name] = true
	}
	return out
}

// Fresh database: every migration is applied and recorded; a second run is
// a no-op.
func TestRunFreshThenNoop(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	ctx := context.Background()
	r := &migrations.Runner{DB: st.DB, Owner: "a", AppVersion: "1.2.3"}
	applied, err := r.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	all := migrations.All()
	if len(applied) != len(all) || applied[0] != "0001_initial" {
		t.Fatalf("applied = %v, want all %d", applied, len(all))
	}
	recs := recorded(t, st.DB)
	for _, m := range all {
		rec, ok := recs[m.ID]
		if !ok {
			t.Fatalf("%s not recorded", m.ID)
		}
		if rec["appVersion"] != "1.2.3" {
			t.Errorf("%s appVersion = %v", m.ID, rec["appVersion"])
		}
		if _, ok := rec["appliedAt"].(bson.DateTime); !ok {
			t.Errorf("%s appliedAt = %#v", m.ID, rec["appliedAt"])
		}
	}
	// A sample of §9.2 indexes, including the unique and TTL ones.
	if !indexNames(t, st.DB, "users")["sub_1"] || !indexNames(t, st.DB, "jobs")["key_1"] ||
		!indexNames(t, st.DB, "notifications")["readAt_ttl"] || !indexNames(t, st.DB, "auditEvents")["objectType_1_objectId_1_at_1"] {
		t.Error("expected §9.2 indexes missing")
	}
	if p, err := migrations.Pending(ctx, st.DB, all); err != nil || len(p) != 0 {
		t.Fatalf("Pending = %v, %v", p, err)
	}

	again, err := (&migrations.Runner{DB: st.DB, Owner: "b", AppVersion: "9.9.9"}).Run(ctx)
	if err != nil || len(again) != 0 {
		t.Fatalf("re-run applied %v, err %v; want no-op", again, err)
	}
	if recorded(t, st.DB)["0001_initial"]["appVersion"] != "1.2.3" {
		t.Error("re-run rewrote the existing record")
	}
}

// A migration interrupted after doing (part of) its work but before being
// recorded is re-run safely and gives the same result.
func TestRerunPartiallyAppliedMigration(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	ctx := context.Background()
	m := migrations.All()[0]
	if err := m.Up(ctx, st.DB); err != nil {
		t.Fatal(err)
	}
	if len(recorded(t, st.DB)) != 0 {
		t.Fatal("Up alone should not record")
	}
	applied, err := (&migrations.Runner{DB: st.DB, Owner: "a"}).Run(ctx)
	if err != nil || len(applied) != len(migrations.All()) {
		t.Fatalf("applied %v, err %v", applied, err)
	}
	// Index creation was idempotent: no duplicates or errors, same set.
	if n := len(indexNames(t, st.DB, "items")); n != 5 { // _id + 4 from §9.2
		t.Errorf("items has %d indexes, want 5", n)
	}
}

// A failing migration is named, not recorded, and stops later ones.
func TestRunStopsAtFailure(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	var ran []string
	mk := func(id string, err error) migrations.Migration {
		return migrations.Migration{ID: id, Up: func(context.Context, *mongo.Database) error { ran = append(ran, id); return err }}
	}
	boom := errors.New("boom")
	r := &migrations.Runner{DB: st.DB, Owner: "a", Migrations: []migrations.Migration{
		mk("0001_ok", nil), mk("0002_bad", boom), mk("0003_later", nil),
	}}
	applied, err := r.Run(context.Background())
	var merr *migrations.Error
	if !errors.As(err, &merr) || merr.ID != "0002_bad" || !errors.Is(err, boom) {
		t.Fatalf("err = %v, want *Error for 0002_bad", err)
	}
	if len(applied) != 1 || applied[0] != "0001_ok" || len(ran) != 2 {
		t.Fatalf("applied %v ran %v", applied, ran)
	}
	recs := recorded(t, st.DB)
	if _, ok := recs["0002_bad"]; ok || len(recs) != 1 {
		t.Fatalf("records = %v", recs)
	}
	// The lease was released, so a fixed run proceeds at once.
	r.Migrations[1] = mk("0002_bad", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if applied, err := r.Run(ctx); err != nil || len(applied) != 2 {
		t.Fatalf("retry applied %v, err %v", applied, err)
	}
}

// Concurrent runs are serialised by the lease: each migration runs once and
// never overlaps with another run; both runs succeed.
func TestConcurrentRunsRespectLease(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	var calls, active, maxActive atomic.Int32
	slow := func(context.Context, *mongo.Database) error {
		calls.Add(1)
		n := active.Add(1)
		for {
			m := maxActive.Load()
			if n <= m || maxActive.CompareAndSwap(m, n) {
				break
			}
		}
		time.Sleep(300 * time.Millisecond)
		active.Add(-1)
		return nil
	}
	ms := []migrations.Migration{{ID: "0001_slow", Up: slow}, {ID: "0002_slow", Up: slow}}

	const n = 4
	var wg sync.WaitGroup
	errs := make([]error, n)
	applied := make([][]string, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := &migrations.Runner{DB: st.DB, Owner: string(rune('a' + i)), Migrations: ms,
				Lease: 3 * time.Second, PollInterval: 20 * time.Millisecond}
			applied[i], errs[i] = r.Run(context.Background())
		}()
	}
	wg.Wait()
	total := 0
	for i := range n {
		if errs[i] != nil {
			t.Fatalf("run %d: %v", i, errs[i])
		}
		total += len(applied[i])
	}
	if calls.Load() != 2 || total != 2 || maxActive.Load() != 1 {
		t.Fatalf("calls=%d total applied=%d max concurrent=%d; want 2, 2, 1", calls.Load(), total, maxActive.Load())
	}
}

// A lease left behind by a crashed migrate expires and is taken over; a live
// one makes the run wait until the context ends.
func TestLeaseExpiryAndWait(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	ctx := context.Background()
	ms := []migrations.Migration{{ID: "0001_x", Up: func(context.Context, *mongo.Database) error { return nil }}}
	lease := st.DB.Collection("migrationLease")

	if _, err := lease.InsertOne(ctx, bson.D{{Key: "_id", Value: "migrate"}, {Key: "leaseOwner", Value: "live"},
		{Key: "leaseUntil", Value: time.Now().Add(time.Hour)}}); err != nil {
		t.Fatal(err)
	}
	short, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	r := &migrations.Runner{DB: st.DB, Owner: "me", Migrations: ms, PollInterval: 20 * time.Millisecond}
	if _, err := r.Run(short); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("with a live lease held elsewhere: err = %v, want deadline exceeded", err)
	}

	if _, err := lease.UpdateOne(ctx, bson.D{{Key: "_id", Value: "migrate"}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "leaseOwner", Value: "dead"}, {Key: "leaseUntil", Value: time.Now().Add(-time.Second)}}}}); err != nil {
		t.Fatal(err)
	}
	if applied, err := r.Run(ctx); err != nil || len(applied) != 1 {
		t.Fatalf("after expiry: applied %v, err %v", applied, err)
	}
	if n, _ := lease.CountDocuments(ctx, bson.D{}); n != 0 {
		t.Fatalf("lease not released: %d docs", n)
	}
}

// serve's readiness (spec §13.2, §18.2, §21.9): /readyz is 503 naming the
// migrations check until migrate has run, then 200 without a restart.
func TestReadinessUntilMigrated(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	check := migrations.NewCheck(st.DB)
	ready := ops.NewReadiness()
	ready.Add("mongodb", st.CheckReplicaSet)
	ready.Add("migrations", check.Ready)
	h := ops.Handler(ops.HandlerOptions{Gatherer: prometheus.NewRegistry(), Readiness: ready})

	probe := func() (int, map[string]string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		var body map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}
	if code, body := probe(); code != http.StatusServiceUnavailable || body["check"] != "migrations" {
		t.Fatalf("before migrate: %d %v, want 503 migrations", code, body)
	}
	if p, _ := check.Pending(context.Background()); len(p) != len(migrations.All()) {
		t.Fatalf("Pending = %v", p)
	}
	if _, err := (&migrations.Runner{DB: st.DB, Owner: "a"}).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if code, body := probe(); code != http.StatusOK {
		t.Fatalf("after migrate: %d %v, want 200", code, body)
	}
}
