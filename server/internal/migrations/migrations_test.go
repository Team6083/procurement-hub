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

	"github.com/team6083/procurement-hub/server/internal/domain"
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
	if len(applied) != len(all) || applied[0] != "0001_reference_rates_decimal" {
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
	if recorded(t, st.DB)["0001_reference_rates_decimal"]["appVersion"] != "1.2.3" {
		t.Error("re-run rewrote the existing record")
	}
}

func insertTeams(t *testing.T, db *mongo.Database, docs ...bson.D) {
	t.Helper()
	for _, d := range docs {
		if _, err := db.Collection("teams").InsertOne(context.Background(), d); err != nil {
			t.Fatal(err)
		}
	}
}

func teamDoc(slug string, rates ...any) bson.D {
	arr := bson.A{}
	for i := 0; i+1 < len(rates); i += 2 {
		arr = append(arr, bson.D{
			{Key: "currency", Value: rates[i]}, {Key: "rateToBase", Value: rates[i+1]},
			{Key: "updatedAt", Value: time.Now()}, {Key: "updatedBy", Value: "x"},
		})
	}
	return bson.D{{Key: "slug", Value: slug}, {Key: "name", Value: slug}, {Key: "referenceRates", Value: arr}}
}

func dec(t *testing.T, s string) bson.Decimal128 {
	t.Helper()
	d, err := bson.ParseDecimal128(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// checkRates asserts every rateToBase is Decimal128 with the wanted values,
// and that the team decodes through the domain model (Decimal128 only).
func checkRates(t *testing.T, db *mongo.Database, slug string, want map[string]string) {
	t.Helper()
	var raw bson.Raw
	if err := db.Collection("teams").FindOne(context.Background(), bson.D{{Key: "slug", Value: slug}}).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	vals, err := raw.Lookup("referenceRates").Array().Values()
	if err != nil {
		t.Fatal(err)
	}
	if len(vals) != len(want) {
		t.Fatalf("%s: %d rates, want %d", slug, len(vals), len(want))
	}
	for _, v := range vals {
		doc := v.Document()
		cur := doc.Lookup("currency").StringValue()
		rv := doc.Lookup("rateToBase")
		if rv.Type != bson.TypeDecimal128 {
			t.Fatalf("%s %s: rateToBase type %v, want Decimal128", slug, cur, rv.Type)
		}
		if got := rv.Decimal128().String(); got != want[cur] {
			t.Errorf("%s %s: rateToBase = %s, want %s", slug, cur, got, want[cur])
		}
		if doc.Lookup("updatedBy").StringValue() != "x" {
			t.Errorf("%s %s: other fields lost: %v", slug, cur, doc)
		}
	}
	var team domain.Team
	if err := bson.Unmarshal(raw, &team); err != nil {
		t.Fatalf("%s: decode as domain.Team: %v", slug, err)
	}
}

// 0001 converts string rates to Decimal128 and leaves Decimal128 ones alone.
func TestReferenceRatesConverted(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	insertTeams(t, st.DB,
		teamDoc("legacy", "TWD", "0.031", "JPY", "0.0067"),
		teamDoc("mixed", "TWD", dec(t, "0.032"), "JPY", "0.0068"),
		teamDoc("modern", "TWD", dec(t, "0.033")),
		bson.D{{Key: "slug", Value: "norates"}, {Key: "referenceRates", Value: bson.A{}}},
	)
	// Legacy strings are no longer readable through the domain model.
	var team domain.Team
	if err := st.DB.Collection("teams").FindOne(context.Background(), bson.D{{Key: "slug", Value: "legacy"}}).Decode(&team); err == nil {
		t.Fatal("string rateToBase decoded without migration; legacy read path should be gone")
	}
	if _, err := (&migrations.Runner{DB: st.DB, Owner: "a"}).Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	checkRates(t, st.DB, "legacy", map[string]string{"TWD": "0.031", "JPY": "0.0067"})
	checkRates(t, st.DB, "mixed", map[string]string{"TWD": "0.032", "JPY": "0.0068"})
	checkRates(t, st.DB, "modern", map[string]string{"TWD": "0.033"})
}

// A migration interrupted after doing (part of) its work but before being
// recorded is re-run safely and gives the same result.
func TestRerunPartiallyAppliedMigration(t *testing.T) {
	st := mongotest.EmptyStore(t, "ph_mig")
	ctx := context.Background()
	insertTeams(t, st.DB, teamDoc("a", "TWD", "0.031"), teamDoc("b", "JPY", "0.0067"))

	// Simulate a crash mid-way: indexes exist, team "a" converted, nothing
	// recorded; then another legacy row appears.
	m := migrations.All()[0]
	if err := m.Up(ctx, st.DB); err != nil {
		t.Fatal(err)
	}
	insertTeams(t, st.DB, teamDoc("c", "TWD", "1.5"))
	if len(recorded(t, st.DB)) != 0 {
		t.Fatal("Up alone should not record")
	}

	applied, err := (&migrations.Runner{DB: st.DB, Owner: "a"}).Run(ctx)
	if err != nil || len(applied) != len(migrations.All()) {
		t.Fatalf("applied %v, err %v", applied, err)
	}
	checkRates(t, st.DB, "a", map[string]string{"TWD": "0.031"})
	checkRates(t, st.DB, "b", map[string]string{"JPY": "0.0067"})
	checkRates(t, st.DB, "c", map[string]string{"TWD": "1.5"})
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

// 0002 makes (batchId, number) unique on orders and is safe to run again.
func TestOrderIndexes(t *testing.T) {
	st := mongotest.Store(t, "ph_mig")
	ctx := context.Background()
	batch := bson.NewObjectID()
	orders := st.DB.Collection("orders")
	if _, err := orders.InsertOne(ctx, bson.D{{Key: "batchId", Value: batch}, {Key: "number", Value: 1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := orders.InsertOne(ctx, bson.D{{Key: "batchId", Value: batch}, {Key: "number", Value: 1}}); !mongo.IsDuplicateKeyError(err) {
		t.Fatalf("duplicate order number: err = %v, want a duplicate key error", err)
	}
	if _, err := orders.InsertOne(ctx, bson.D{{Key: "batchId", Value: bson.NewObjectID()}, {Key: "number", Value: 1}}); err != nil {
		t.Fatalf("same number in another batch: %v", err)
	}
	// Running the migration again changes nothing.
	for _, m := range migrations.All() {
		if m.ID == "0002_order_indexes" {
			if err := m.Up(ctx, st.DB); err != nil {
				t.Fatal(err)
			}
		}
	}
}
