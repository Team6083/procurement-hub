package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestRunDispatch(t *testing.T) {
	cases := []struct {
		name       string
		args       []string
		code       int
		wantStdout string
		wantStderr string
	}{
		{"migrate stub", []string{"migrate"}, 0, "no migrations registered", ""},
		{"help", []string{"--help"}, 0, "usage: procurement-hub", ""},
		{"unknown", []string{"bogus"}, 2, "", `unknown command "bogus"`},
		{"extra args", []string{"migrate", "x"}, 2, "", "takes no arguments"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if got := run(c.args, &stdout, &stderr); got != c.code {
				t.Fatalf("exit code = %d, want %d (stderr: %s)", got, c.code, stderr.String())
			}
			if c.wantStdout != "" && !strings.Contains(stdout.String(), c.wantStdout) {
				t.Errorf("stdout = %q, want it to contain %q", stdout.String(), c.wantStdout)
			}
			if c.wantStderr != "" {
				if !strings.Contains(stderr.String(), c.wantStderr) || !strings.Contains(stderr.String(), "usage:") {
					t.Errorf("stderr = %q, want %q and usage", stderr.String(), c.wantStderr)
				}
			}
		})
	}
}

func TestDefaultCommandIsServe(t *testing.T) {
	saved := commands["serve"]
	defer func() { commands["serve"] = saved }()
	called := false
	commands["serve"] = func(_ io.Writer) error { called = true; return nil }
	if code := run(nil, &bytes.Buffer{}, &bytes.Buffer{}); code != 0 || !called {
		t.Fatalf("run(nil) = %d, serve called = %v", code, called)
	}
}
