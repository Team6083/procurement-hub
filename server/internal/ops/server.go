package ops

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// Server timeouts (spec §18.2). There is deliberately no WriteTimeout: CSV
// exports may stream for longer than any fixed limit.
const (
	ReadHeaderTimeout = 10 * time.Second
	IdleTimeout       = 120 * time.Second
)

// NewServer returns an http.Server with the standard timeouts. It is used for
// both the API and the ops server.
func NewServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr: addr, Handler: h,
		ReadHeaderTimeout: ReadHeaderTimeout,
		IdleTimeout:       IdleTimeout,
	}
}

// ServeConfig describes what Serve runs.
type ServeConfig struct {
	API *http.Server
	Ops *http.Server // nil when METRICS_LISTEN_ADDR=off
	// Readiness is drained when shutdown starts so /readyz answers 503.
	Readiness *Readiness
	// ShutdownTimeout bounds waiting for in-flight requests and background
	// work (SHUTDOWN_TIMEOUT).
	ShutdownTimeout time.Duration
	// Background functions run until their context is cancelled at shutdown
	// and must return promptly afterwards (the job runner releases its
	// leases before returning).
	Background []func(ctx context.Context)
	Logger     *slog.Logger // nil means slog.Default()
}

// Serve binds every server's address, runs the servers and background work,
// and shuts down gracefully when ctx is cancelled (SIGTERM/SIGINT):
//
//  1. mark not ready (/readyz 503; /healthz stays 200),
//  2. stop accepting API connections and wait for in-flight requests, while
//     background work is cancelled and releases its leases, both bounded by
//     ShutdownTimeout,
//  3. stop the ops server last, so probes are answered throughout.
//
// A bind error (e.g. port already in use) is returned before anything starts.
// A server that fails while running triggers the same shutdown and its error
// is returned.
func Serve(ctx context.Context, c ServeConfig) error {
	logger := c.Logger
	if logger == nil {
		logger = slog.Default()
	}
	servers := []*http.Server{c.API}
	if c.Ops != nil {
		servers = append(servers, c.Ops)
	}
	listeners := make([]net.Listener, 0, len(servers))
	for _, s := range servers {
		ln, err := net.Listen("tcp", s.Addr)
		if err != nil {
			for _, l := range listeners {
				_ = l.Close()
			}
			return fmt.Errorf("listen %s: %w", s.Addr, err)
		}
		listeners = append(listeners, ln)
	}

	errc := make(chan error, len(servers))
	for i, s := range servers {
		ln := listeners[i]
		logger.Info("listening", "addr", ln.Addr().String())
		go func() {
			if err := s.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
				errc <- fmt.Errorf("serve %s: %w", s.Addr, err)
			}
		}()
	}

	bgCtx, stopBackground := context.WithCancel(context.WithoutCancel(ctx))
	defer stopBackground()
	var bg sync.WaitGroup
	for _, fn := range c.Background {
		bg.Go(func() { fn(bgCtx) })
	}

	var serveErr error
	select {
	case <-ctx.Done():
		logger.Info("shutting down", "timeout", c.ShutdownTimeout.String())
	case serveErr = <-errc:
		logger.Error("server failed; shutting down", "error", serveErr)
	}

	if c.Readiness != nil {
		c.Readiness.Drain()
	}
	sctx, cancel := context.WithTimeout(context.Background(), c.ShutdownTimeout)
	defer cancel()

	var wg sync.WaitGroup
	wg.Go(func() {
		if err := c.API.Shutdown(sctx); err != nil {
			logger.Warn("in-flight requests did not finish before the shutdown timeout", "error", err)
			_ = c.API.Close()
		}
	})
	wg.Go(func() {
		stopBackground()
		done := make(chan struct{})
		go func() { bg.Wait(); close(done) }()
		select {
		case <-done:
		case <-sctx.Done():
			logger.Warn("background work did not stop before the shutdown timeout")
		}
	})
	wg.Wait()

	if c.Ops != nil {
		octx, ocancel := context.WithTimeout(context.Background(), time.Second)
		defer ocancel()
		if err := c.Ops.Shutdown(octx); err != nil {
			_ = c.Ops.Close()
		}
	}
	logger.Info("shutdown complete")
	return serveErr
}
