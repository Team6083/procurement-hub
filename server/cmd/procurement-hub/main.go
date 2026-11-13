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
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/app"
	"github.com/team6083/procurement-hub/server/internal/auth"
	"github.com/team6083/procurement-hub/server/internal/config"
	"github.com/team6083/procurement-hub/server/internal/httpapi"
	"github.com/team6083/procurement-hub/server/internal/jobs"
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
		slog.Error("fatal", "command", name, "error", err)
		return 1
	}
	return 0
}

// migrate is a placeholder until versioned migrations (spec §13.2) are
// implemented; it registers nothing and always succeeds.
// TODO(migrations): replace with the real migration runner.
func migrate(stdout io.Writer) error {
	_, err := fmt.Fprintln(stdout, "procurement-hub migrate: no migrations registered")
	return err
}

// serve runs the API and ops servers until SIGINT/SIGTERM.
func serve() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		lvl = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		return err
	}
	defer st.Close(context.Background())
	if err := st.EnsureIndexes(ctx); err != nil {
		return err
	}

	rm := service.NewRoleMappings(st)
	if err := rm.LoadFile(ctx, cfg.RoleMappingsFile); err != nil {
		return err
	}
	verifier, err := auth.NewVerifier(ctx, auth.VerifierConfig{
		IssuerURL: cfg.OIDCIssuerURL, Audience: cfg.OIDCAudience, GroupsClaim: cfg.OIDCGroupsClaim,
		RolesClaim: cfg.OIDCRolesClaim, AdminRoles: cfg.OIDCAdminRoles, ClockSkew: cfg.OIDCClockSkew,
	})
	if err != nil {
		return err
	}

	reg := prometheus.NewRegistry()
	metrics := httpapi.NewMetrics(reg)

	handler, batches := app.NewHandler(app.Deps{
		Config: cfg, Store: st, Verifier: verifier, RoleMappings: rm,
		Version: httpapi.Version{Version: version, Commit: commit}, Metrics: metrics,
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
	go runner.Run(ctx)

	api := &http.Server{Addr: cfg.HTTPAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	ops := &http.Server{
		Addr: cfg.MetricsAddr, ReadHeaderTimeout: 10 * time.Second,
		Handler: httpapi.OpsHandler(reg, map[string]httpapi.ReadyCheck{
			"mongodb": st.CheckReplicaSet,
		}),
	}

	errc := make(chan error, 2)
	for _, s := range []*http.Server{api, ops} {
		go func() {
			slog.Info("listening", "addr", s.Addr)
			if err := s.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
				errc <- err
			}
		}()
	}
	select {
	case <-ctx.Done():
	case err := <-errc:
		return err
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = api.Shutdown(shutdown)
	_ = ops.Shutdown(shutdown)
	return nil
}
