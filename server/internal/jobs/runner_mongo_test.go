package jobs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/store"
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	uri := os.Getenv("TEST_MONGODB_URI")
	if uri == "" {
		t.Skip("TEST_MONGODB_URI not set")
	}
	ctx := context.Background()
	st, err := store.Connect(ctx, uri, fmt.Sprintf("ph_jobs_%d", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.DB.Drop(ctx); _ = st.Close(ctx) })
	return st
}

func loadJob(t *testing.T, st *store.Store, key string) *store.Job {
	t.Helper()
	var j store.Job
	if err := st.DB.Collection("jobs").FindOne(context.Background(), bson.D{{Key: "key", Value: key}}).Decode(&j); err != nil {
		t.Fatalf("load job %s: %v", key, err)
	}
	return &j
}

// On shutdown the runner stops, and a job interrupted mid-run gets its lease
// released at once (no backoff, attempt not counted) instead of waiting for
// the lease to expire.
func TestRunnerReleasesLeaseOnShutdown(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	if err := st.UpsertJob(ctx, "slow:1", "slow", time.Now().Add(-time.Second), bson.M{}); err != nil {
		t.Fatal(err)
	}
	reg := prometheus.NewRegistry()
	r := New(st, Options{Owner: "replica-a", Poll: 20 * time.Millisecond}, reg)
	running := make(chan struct{})
	r.Register("slow", func(ctx context.Context, _ *store.Job) error {
		close(running)
		<-ctx.Done()
		return ctx.Err()
	})

	rctx, cancel := context.WithCancel(ctx)
	stopped := make(chan struct{})
	go func() { r.Run(rctx); close(stopped) }()
	<-running
	if j := loadJob(t, st, "slow:1"); j.Status != store.JobRunning || j.LeaseOwner != "replica-a" {
		t.Fatalf("while running: %+v", j)
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("runner did not stop")
	}
	j := loadJob(t, st, "slow:1")
	if j.Status != store.JobPending || j.LeaseOwner != "" || !j.LeaseUntil.IsZero() || j.Attempts != 0 || j.RunAt.After(time.Now()) {
		t.Fatalf("after shutdown: %+v", j)
	}
	if got := testutil.ToFloat64(r.failures.WithLabelValues("slow")); got != 0 {
		t.Errorf("shutdown counted as a failure: %v", got)
	}
}

func TestRunnerMetrics(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	past := time.Now().Add(-time.Second)
	for _, k := range []string{"ok:1", "bad:1"} {
		if err := st.UpsertJob(ctx, k, strings.Split(k, ":")[0], past, bson.M{}); err != nil {
			t.Fatal(err)
		}
	}
	reg := prometheus.NewRegistry()
	r := New(st, Options{Owner: "replica-a"}, reg)
	r.Register("ok", func(context.Context, *store.Job) error { return nil })
	r.Register("bad", func(context.Context, *store.Job) error { return errors.New("boom") })
	for r.runOne(ctx) {
	}
	if testutil.ToFloat64(r.runs.WithLabelValues("ok")) != 1 || testutil.ToFloat64(r.runs.WithLabelValues("bad")) != 1 ||
		testutil.ToFloat64(r.failures.WithLabelValues("bad")) != 1 || testutil.ToFloat64(r.failures.WithLabelValues("ok")) != 0 {
		t.Fatal("unexpected job metric values")
	}
	n, err := testutil.GatherAndCount(reg, "procurement_hub_job_runs_total", "procurement_hub_job_failures_total")
	if err != nil || n != 4 {
		t.Fatalf("gathered %d series, err %v", n, err)
	}
	if j := loadJob(t, st, "bad:1"); j.Status != store.JobPending || j.Attempts != 1 || !j.RunAt.After(time.Now()) {
		t.Fatalf("failed job not rescheduled with backoff: %+v", j)
	}
}
