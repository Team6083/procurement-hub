package ops

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

// freeAddr returns a loopback address that was free a moment ago.
func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}

func status(t *testing.T, url string) int {
	t.Helper()
	c := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	resp, err := c.Get(url)
	if err != nil {
		return -1
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestNewServerTimeouts(t *testing.T) {
	s := NewServer(":0", http.NotFoundHandler())
	if s.ReadHeaderTimeout != 10*time.Second || s.IdleTimeout != 120*time.Second || s.WriteTimeout != 0 || s.ReadTimeout != 0 {
		t.Fatalf("timeouts: header=%v idle=%v write=%v read=%v", s.ReadHeaderTimeout, s.IdleTimeout, s.WriteTimeout, s.ReadTimeout)
	}
}

// A real SIGTERM marks the process not ready while in-flight requests finish,
// /healthz keeps answering, new API connections are refused, and background
// work is stopped before Serve returns.
func TestServeGracefulShutdownOnSIGTERM(t *testing.T) {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stop()

	started, release := make(chan struct{}), make(chan struct{})
	api := http.NewServeMux()
	api.HandleFunc("GET /slow", func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		_, _ = w.Write([]byte("done"))
	})
	api.HandleFunc("GET /fast", func(http.ResponseWriter, *http.Request) {})

	var bgStopped atomic.Bool
	ready := NewReadiness()
	ready.Add("dep", func(context.Context) error { return nil })
	apiAddr, opsAddr := freeAddr(t), freeAddr(t)
	served := make(chan error, 1)
	go func() {
		served <- Serve(ctx, ServeConfig{
			API:             NewServer(apiAddr, api),
			Ops:             NewServer(opsAddr, Handler(HandlerOptions{Gatherer: prometheus.NewRegistry(), Readiness: ready, Logger: quietLogger()})),
			Readiness:       ready,
			ShutdownTimeout: 10 * time.Second,
			Background: []func(context.Context){func(ctx context.Context) {
				<-ctx.Done()
				time.Sleep(50 * time.Millisecond) // e.g. releasing a lease
				bgStopped.Store(true)
			}},
			Logger: quietLogger(),
		})
	}()

	waitFor(t, "readyz 200", func() bool { return status(t, "http://"+opsAddr+"/readyz") == 200 })
	if got := status(t, "http://"+apiAddr+"/fast"); got != 200 {
		t.Fatalf("api before shutdown: %d", got)
	}

	slow := make(chan int, 1)
	go func() { slow <- status(t, "http://"+apiAddr+"/slow") }()
	<-started

	if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "readyz 503", func() bool { return status(t, "http://"+opsAddr+"/readyz") == 503 })
	if got := status(t, "http://"+opsAddr+"/healthz"); got != 200 {
		t.Fatalf("healthz during shutdown: %d", got)
	}
	waitFor(t, "API to refuse new connections", func() bool {
		c, err := net.DialTimeout("tcp", apiAddr, time.Second)
		if err == nil {
			_ = c.Close()
		}
		return err != nil
	})
	select {
	case err := <-served:
		t.Fatalf("Serve returned with a request in flight: %v", err)
	default:
	}

	close(release)
	if got := <-slow; got != 200 {
		t.Fatalf("in-flight request: %d", got)
	}
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return")
	}
	if !bgStopped.Load() {
		t.Fatal("Serve returned before background work stopped")
	}
	if status(t, "http://"+opsAddr+"/healthz") != -1 {
		t.Fatal("ops server still running after Serve returned")
	}
}

func TestServeShutdownTimeoutBoundsInFlightRequests(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	block := make(chan struct{})
	defer close(block)
	api := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { close(started); <-block })
	addr := freeAddr(t)
	served := make(chan error, 1)
	go func() {
		served <- Serve(ctx, ServeConfig{API: NewServer(addr, api), ShutdownTimeout: 200 * time.Millisecond, Logger: quietLogger()})
	}()
	waitFor(t, "listening", func() bool {
		c, err := net.Dial("tcp", addr)
		if err == nil {
			_ = c.Close()
		}
		return err == nil
	})
	go func() { status(t, "http://"+addr+"/") }()
	<-started
	begin := time.Now()
	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
		if d := time.Since(begin); d > 2*time.Second {
			t.Fatalf("shutdown took %v", d)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve ignored ShutdownTimeout")
	}
}

func TestServePortInUse(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ln.Close() }()

	for _, tc := range []struct{ name, api, ops string }{
		{"api", ln.Addr().String(), freeAddr(t)},
		{"ops", freeAddr(t), ln.Addr().String()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var bgStarted atomic.Bool
			err := Serve(context.Background(), ServeConfig{
				API: NewServer(tc.api, http.NotFoundHandler()), Ops: NewServer(tc.ops, http.NotFoundHandler()),
				ShutdownTimeout: time.Second, Logger: quietLogger(),
				Background: []func(context.Context){func(context.Context) { bgStarted.Store(true) }},
			})
			if err == nil || !errors.Is(err, syscall.EADDRINUSE) || !strings.Contains(err.Error(), ln.Addr().String()) {
				t.Fatalf("err = %v, want address in use", err)
			}
			if bgStarted.Load() {
				t.Fatal("background work started despite the bind error")
			}
			// The other address must have been released again.
			other := tc.ops
			if tc.name == "ops" {
				other = tc.api
			}
			l, err := net.Listen("tcp", other)
			if err != nil {
				t.Fatalf("%s still bound: %v", other, err)
			}
			_ = l.Close()
		})
	}
}
