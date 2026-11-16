package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/app"
	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/config"
	"github.com/team6083/procurement-hub/server/internal/httpapi"
	"github.com/team6083/procurement-hub/server/internal/jobs"
	"github.com/team6083/procurement-hub/server/internal/migrations"
	"github.com/team6083/procurement-hub/server/internal/ops"
	"github.com/team6083/procurement-hub/server/internal/service"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Set at build time via -ldflags.
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// commands maps each subcommand name to its implementation. "serve" is the
// default when no subcommand is given.
var commands = map[string]func(stdout io.Writer) error{
	"serve":   func(io.Writer) error { return serve() },
	"migrate": migrate,
}

const usage = `usage: procurement-hub [command]

Commands:
  serve     run the HTTP API and background jobs (default)
  migrate   apply pending data migrations and exit
`

// run dispatches to a subcommand and returns the process exit code.
func run(args []string, stdout, stderr io.Writer) int {
	name := "serve"
	if len(args) > 0 {
		name = args[0]
	}
	switch name {
	case "-h", "-help", "--help", "help":
		_, _ = fmt.Fprint(stdout, usage)
		return 0
	}
	cmd, ok := commands[name]
	if !ok || len(args) > 1 {
		if !ok {
			_, _ = fmt.Fprintf(stderr, "procurement-hub: unknown command %q\n\n", name)
		} else {
			_, _ = fmt.Fprintf(stderr, "procurement-hub: %s takes no arguments\n\n", name)
		}
		_, _ = fmt.Fprint(stderr, usage)
		return 2
	}
	if err := cmd(stdout); err != nil {
		var cerr *config.Error
		if errors.As(err, &cerr) {
			// Print every configuration problem on its own line, not one
			// escaped log value, so operators can read the list at once.
			_, _ = fmt.Fprintln(stderr, "procurement-hub: invalid configuration:")
			for _, p := range cerr.Problems {
				_, _ = fmt.Fprintf(stderr, "  - %v\n", p)
			}
			return 1
		}
		slog.Error("fatal", "command", name, "error", err)
		return 1
	}
	return 0
}

// migrate applies pending data migrations (spec §13.2) under a MongoDB lease
// and exits; a failure names the migration and exits 1. It needs only
// MONGO_URI (and optionally LOG_LEVEL), so a one-off Job can run it with
// the same image and environment as serve.
func migrate(stdout io.Writer) error {
	cfg, err := config.LoadMigrate(os.Getenv)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: cfg.LogLevel})))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close(context.Background()) }()

	host, _ := os.Hostname()
	r := migrations.NewRunner(st, fmt.Sprintf("%s-%d", host, os.Getpid()), version)
	applied, err := r.Run(ctx)
	if err != nil {
		return err
	}
	slog.Info("migrations complete", "applied", len(applied), "registered", len(migrations.All()))
	return nil
}

// serve runs the API and ops servers until SIGINT/SIGTERM; the shutdown
// sequence lives in ops.Serve.
func serve() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	// ContextHandler adds request_id to logs written with a request context.
	slog.SetDefault(slog.New(ops.NewContextHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))))
	slog.Info("effective configuration", "config", cfg) // secrets masked by Config.LogValue

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close(context.Background()) }()

	// serve never applies migrations (spec §13.2): until `migrate` has run,
	// /readyz stays 503. The check re-reads the records on each probe, so the
	// process becomes ready without a restart once migrate finishes.
	migrationCheck := migrations.NewCheck(st.DB)
	if pending, err := migrationCheck.Pending(ctx); err != nil {
		return err
	} else if len(pending) > 0 {
		slog.Warn("pending migrations; not ready until `procurement-hub migrate` runs", "pending", pending)
	}

	rm := service.NewRoleMappings(st)
	if err := rm.LoadFile(ctx, cfg.RoleMappingsFile); err != nil {
		return err
	}
	// Discovery runs in the background with retries: an unreachable IdP keeps
	// /readyz at 503 (check "oidc") instead of stopping serve (spec §18.2).
	verifier, err := auth.NewVerifier(auth.VerifierConfig{
		IssuerURL: cfg.OIDCIssuer, Audience: cfg.OIDCAudience, GroupsClaim: cfg.OIDCGroupsClaim,
		AdminRoles: cfg.AdminRoles, PurchaserRoles: cfg.PurchaserRoles, ReceiverRoles: cfg.ReceiverRoles, ClockSkew: cfg.OIDCClockSkew,
	})
	if err != nil {
		return err
	}

	reg := ops.NewRegistry()
	handler, batches := app.NewHandler(app.Deps{
		Config: cfg, Store: st, Verifier: verifier, RoleMappings: rm,
		Version: httpapi.Version{Version: version, Commit: commit}, Metrics: ops.NewHTTPMetrics(reg),
	})

	host, _ := os.Hostname()
	runner := jobs.New(st, jobs.Options{Owner: fmt.Sprintf("%s-%d", host, os.Getpid())}, reg)
	runner.Register(service.JobBatchClose, func(ctx context.Context, j *store.Job) error {
		id, ok := j.Payload["batchId"].(bson.ObjectID)
		if !ok {
			return errors.New("batch.close job without batchId")
		}
		return batches.CloseDue(ctx, id)
	})
	// Deadline reminders become notifications in milestone 6; until then the
	// job is consumed so it does not linger.
	runner.Register(service.JobBatchDeadlineReminder, func(context.Context, *store.Job) error { return nil })

	// Readiness checks (spec §18.2).
	ready := ops.NewReadiness()
	ready.Add("mongodb", st.CheckReplicaSet)
	ready.Add("oidc", verifier.Ready)
	ready.Add("migrations", migrationCheck.Ready)

	var opsServer *http.Server
	if cfg.MetricsListenAddr != "" { // empty when METRICS_LISTEN_ADDR=off
		opsServer = ops.NewServer(cfg.MetricsListenAddr, ops.Handler(ops.HandlerOptions{Gatherer: reg, Readiness: ready}))
	}
	return ops.Serve(ctx, ops.ServeConfig{
		API:             ops.NewServer(cfg.ListenAddr, handler),
		Ops:             opsServer,
		Readiness:       ready,
		ShutdownTimeout: cfg.ShutdownTimeout,
		Background:      []func(context.Context){verifier.Run, runner.Run},
	})
}
