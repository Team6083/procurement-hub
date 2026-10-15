package jobs

import (
	"testing"
	"time"
)

func TestBackoff(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{1, 30 * time.Second},
		{2, time.Minute},
		{3, 2 * time.Minute},
		{6, 16 * time.Minute},
		{7, 30 * time.Minute},
		{50, 30 * time.Minute},
	}
	for _, tt := range tests {
		if got := backoff(tt.attempt); got != tt.want {
			t.Errorf("backoff(%d) = %v, want %v", tt.attempt, got, tt.want)
		}
	}
}
