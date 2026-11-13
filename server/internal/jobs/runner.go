// Package jobs is a lease-based runner over the `jobs` collection (spec §13).
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/team6083/procurement-hub/server/internal/store"
)

// Handler runs one job. It must be idempotent: jobs may run more than once
// (lease expiry, retries).
type Handler func(ctx context.Context, job *store.Job) error

type Runner struct {
	st       *store.Store
	owner    string
	handlers map[string]Handler
	lease    time.Duration
	poll     time.Duration
	runs     *prometheus.CounterVec
	failures *prometheus.CounterVec
	now      func() time.Time
}

type Options struct {
	Owner string        // unique per replica
	Lease time.Duration // default 60s
	Poll  time.Duration // default 5s
}

func New(st *store.Store, opts Options, reg prometheus.Registerer) *Runner {
	if opts.Lease == 0 {
		opts.Lease = 60 * time.Second
	}
	if opts.Poll == 0 {
		opts.Poll = 5 * time.Second
	}
	r := &Runner{
		st: st, owner: opts.Owner, handlers: map[string]Handler{}, lease: opts.Lease, poll: opts.Poll,
		runs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "procurement_hub_job_runs_total", Help: "Background job executions (successful or failed) by job type.",
		}, []string{"type"}),
		failures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "procurement_hub_job_failures_total", Help: "Failed background job executions (error, panic or no handler) by job type.",
		}, []string{"type"}),
		now: func() time.Time { return time.Now().UTC() },
	}
	if reg != nil {
		reg.MustRegister(r.runs, r.failures)
	}
	return r
}

func (r *Runner) Register(jobType string, h Handler) { r.handlers[jobType] = h }

// Run polls until ctx is cancelled. A job interrupted by cancellation has its
// lease released before Run returns, so another replica can take it at once.
func (r *Runner) Run(ctx context.Context) {
	t := time.NewTicker(r.poll)
	defer t.Stop()
	for {
		// Drain everything that is due before sleeping.
		for r.runOne(ctx) {
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// runOne claims and executes at most one job; it reports whether one ran.
func (r *Runner) runOne(ctx context.Context) bool {
	if ctx.Err() != nil {
		return false
	}
	job, err := r.st.ClaimDueJob(ctx, r.owner, r.now(), r.lease)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			slog.Error("claim job failed", "error", err)
		}
		return false
	}
	h, ok := r.handlers[job.Type]
	if !ok {
		slog.Error("no handler for job type", "type", job.Type, "key", job.Key)
		r.runs.WithLabelValues(job.Type).Inc()
		r.failures.WithLabelValues(job.Type).Inc()
		// Leave the lease to expire; another replica with the handler may take it.
		return true
	}

	// Renew the lease while the handler runs.
	hctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		t := time.NewTicker(r.lease / 3)
		defer t.Stop()
		for {
			select {
			case <-hctx.Done():
				return
			case <-t.C:
				if ok, err := r.st.RenewLease(hctx, job.ID, r.owner, r.now().Add(r.lease)); err != nil || !ok {
					slog.Warn("job lease lost", "key", job.Key, "error", err)
					cancel()
					return
				}
			}
		}
	}()

	err = safeRun(hctx, h, job)
	cancel()
	<-done

	// Use a fresh context so completion is recorded even during shutdown.
	fctx, fcancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer fcancel()
	if err != nil && ctx.Err() != nil {
		// Shutdown interrupted the job: not a failure, release without backoff.
		slog.Info("job interrupted by shutdown; lease released", "type", job.Type, "key", job.Key)
		if rerr := r.st.AbandonJob(fctx, job.ID, r.owner); rerr != nil {
			slog.Error("release job failed", "key", job.Key, "error", rerr)
		}
		return false
	}
	r.runs.WithLabelValues(job.Type).Inc()
	if err != nil {
		slog.Error("job failed", "type", job.Type, "key", job.Key, "attempt", job.Attempts, "error", err)
		r.failures.WithLabelValues(job.Type).Inc()
		if rerr := r.st.ReleaseJob(fctx, job.ID, r.owner, r.now().Add(backoff(job.Attempts))); rerr != nil {
			slog.Error("release job failed", "key", job.Key, "error", rerr)
		}
		return true
	}
	if cerr := r.st.CompleteJob(fctx, job.ID, r.owner); cerr != nil {
		slog.Error("complete job failed", "key", job.Key, "error", cerr)
	}
	return true
}

func safeRun(ctx context.Context, h Handler, job *store.Job) (err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
	}()
	return h(ctx, job)
}

// backoff is 30s doubling per attempt, capped at 30 minutes.
func backoff(attempt int) time.Duration {
	d := 30 * time.Second
	for i := 1; i < attempt && d < 30*time.Minute; i++ {
		d *= 2
	}
	if d > 30*time.Minute {
		d = 30 * time.Minute
	}
	return d
}
