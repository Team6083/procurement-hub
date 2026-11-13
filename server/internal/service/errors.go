package service

import (
	"errors"
	"fmt"
	"strconv"
	"time"
)

// Sentinel business errors; httpapi maps them to status codes.
var (
	ErrForbidden       = errors.New("forbidden")
	ErrNotFound        = errors.New("not found")
	ErrVersionConflict = errors.New("version conflict")
)

// RuleError is a business-rule violation (HTTP 422) with a stable code.
type RuleError struct {
	Code    string
	Message string
}

func (e *RuleError) Error() string { return e.Code + ": " + e.Message }

func Rule(code, format string, a ...any) *RuleError {
	return &RuleError{Code: code, Message: fmt.Sprintf(format, a...)}
}

// ValidationError is an input validation failure (HTTP 400) with per-field messages.
type ValidationError struct{ Fields map[string]string }

func (e *ValidationError) Error() string { return fmt.Sprintf("validation failed: %v", e.Fields) }

func Invalid(field, msg string) *ValidationError {
	return &ValidationError{Fields: map[string]string{field: msg}}
}

func bsonNow() time.Time { return time.Now().UTC() }

func strconvItoa(i int) string { return strconv.Itoa(i) }
