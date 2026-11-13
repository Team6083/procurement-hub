// Package mongotest gives integration tests a MongoDB replica set.
//
// By default it starts one mongo container per test package with
// testcontainers-go (so Docker must be available), lazily on first use, and
// removes it when the package's tests end. Environment:
//
//   - TEST_MONGODB_URI: use this replica set instead of starting a container
//     (e.g. mongodb://localhost:27017/?replicaSet=rs0&directConnection=true).
//   - SKIP_INTEGRATION=1: skip integration tests instead of failing when no
//     MongoDB is available.
//
// Without either, a missing Docker daemon fails the tests with a clear message.
package mongotest

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"

	"github.com/team6083/procurement-hub/server/internal/migrations"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Image is the MongoDB image started when TEST_MONGODB_URI is unset.
const Image = "mongo:8"

var (
	once     sync.Once
	uri      string
	startErr error
	ctr      *tcmongo.MongoDBContainer
	used     atomic.Bool
	dbSeq    atomic.Int64
)

// Main runs the package's tests and then removes the container, if one was
// started. Call it from TestMain: os.Exit(mongotest.Main(m)).
func Main(m *testing.M) int {
	code := m.Run()
	if ctr != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := testcontainers.TerminateContainer(ctr, testcontainers.StopContext(ctx)); err != nil {
			fmt.Fprintln(os.Stderr, "mongotest: terminate container:", err)
		}
	}
	return code
}

// Used reports whether any test in this package obtained a MongoDB.
func Used() bool { return used.Load() }

// URI returns the replica set's connection string without a database name.
// It skips the test when SKIP_INTEGRATION=1 and fails it when no MongoDB can
// be provided.
func URI(t testing.TB) string {
	t.Helper()
	if os.Getenv("SKIP_INTEGRATION") == "1" {
		t.Skip("SKIP_INTEGRATION=1: skipping MongoDB integration test")
	}
	once.Do(func() {
		if v := os.Getenv("TEST_MONGODB_URI"); v != "" {
			uri = v
			return
		}
		uri, startErr = start()
	})
	if startErr != nil {
		t.Fatalf("integration tests need a MongoDB replica set: could not start one with testcontainers "+
			"(is Docker running?): %v\nSet TEST_MONGODB_URI to use an existing replica set, "+
			"or SKIP_INTEGRATION=1 to skip these tests.", startErr)
	}
	used.Store(true)
	return uri
}

func start() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	c, err := tcmongo.Run(ctx, Image,
		tcmongo.WithReplicaSet("rs0"),
		// The default open-file limit (1024 on some hosts) makes mongod hang
		// on "Too many open files" once many test databases exist.
		testcontainers.WithHostConfigModifier(func(hc *container.HostConfig) {
			hc.Ulimits = append(hc.Ulimits, &container.Ulimit{Name: "nofile", Soft: 64000, Hard: 64000})
		}),
	)
	if c != nil {
		ctr = c
	}
	if err != nil {
		return "", err
	}
	cs, err := c.ConnectionString(ctx)
	if err != nil {
		return "", err
	}
	// The member is registered under the container's internal IP; connect
	// directly to the mapped port instead of following the replica set config.
	sep := "?"
	if strings.Contains(cs, "?") {
		sep = "&"
	}
	cs += sep + "directConnection=true"

	// rs.initiate returns before the member becomes primary.
	for {
		st, err := store.Connect(ctx, cs, "admin")
		if err == nil {
			_ = st.Close(ctx)
			return cs, nil
		}
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("waiting for primary: %w", err)
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// WithDatabase puts a database name into the path of a MongoDB URI such as
// URI's result, which has none ("mongodb://host/?replicaSet=rs0").
func WithDatabase(uri, db string) string {
	base, query, hasQuery := strings.Cut(uri, "?")
	scheme, rest, _ := strings.Cut(base, "://")
	hosts, _, _ := strings.Cut(rest, "/")
	out := scheme + "://" + hosts + "/" + db
	if hasQuery {
		out += "?" + query
	}
	return out
}

// DatabaseName returns a fresh throwaway database name with this prefix.
func DatabaseName(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), dbSeq.Add(1))
}

// Store connects to a fresh database, applies all migrations (indexes
// included) and drops the database when the test ends.
func Store(t testing.TB, prefix string) *store.Store {
	t.Helper()
	st := EmptyStore(t, prefix)
	if _, err := (&migrations.Runner{DB: st.DB, Owner: "test"}).Run(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}

// EmptyStore is Store without migrations.
func EmptyStore(t testing.TB, prefix string) *store.Store {
	t.Helper()
	u := URI(t)
	ctx := context.Background()
	st, err := store.Connect(ctx, u, DatabaseName(prefix))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = st.DB.Drop(ctx)
		_ = st.Close(ctx)
	})
	return st
}
