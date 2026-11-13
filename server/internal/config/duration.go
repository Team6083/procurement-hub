package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// parseDuration parses a Go duration (time.ParseDuration) that may also use
// a "d" unit of 24 hours, alone or combined with other units: "90d", "1.5d",
// "1d12h", "-2d".
func parseDuration(s string) (time.Duration, error) {
	if !strings.Contains(s, "d") {
		d, err := time.ParseDuration(s)
		if err != nil {
			return 0, fmt.Errorf("invalid duration %q", s)
		}
		return d, nil
	}
	invalid := fmt.Errorf("invalid duration %q", s)
	rest := s
	neg := false
	if rest != "" && (rest[0] == '-' || rest[0] == '+') {
		neg = rest[0] == '-'
		rest = rest[1:]
	}
	// Split off every "<number>d" component; the rest goes to time.ParseDuration.
	var days float64
	var others strings.Builder
	for rest != "" {
		i := 0
		for i < len(rest) && (rest[i] >= '0' && rest[i] <= '9' || rest[i] == '.') {
			i++
		}
		if i == 0 {
			return 0, invalid
		}
		num := rest[:i]
		j := i
		for j < len(rest) && !(rest[j] >= '0' && rest[j] <= '9' || rest[j] == '.') {
			j++
		}
		unit := rest[i:j]
		rest = rest[j:]
		if unit != "d" {
			others.WriteString(num + unit)
			continue
		}
		f, err := strconv.ParseFloat(num, 64)
		if err != nil {
			return 0, invalid
		}
		days += f
	}
	var d time.Duration
	if others.Len() > 0 {
		var err error
		if d, err = time.ParseDuration(others.String()); err != nil {
			return 0, invalid
		}
	}
	dayNanos := days * 24 * float64(time.Hour)
	if dayNanos+float64(d) > math.MaxInt64 {
		return 0, fmt.Errorf("duration %q out of range", s)
	}
	d += time.Duration(dayNanos)
	if neg {
		d = -d
	}
	return d, nil
}
