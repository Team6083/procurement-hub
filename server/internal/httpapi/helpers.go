package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/service"
)

// decode reads a strict JSON body (unknown fields rejected).
func decode(r *http.Request, v any) *APIError {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return NewError(http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE", "Request body too large.")
		}
		if errors.Is(err, io.EOF) {
			return NewError(http.StatusBadRequest, "INVALID_BODY", "Request body is required.")
		}
		return NewError(http.StatusBadRequest, "INVALID_BODY", "Malformed JSON body.")
	}
	return nil
}

// ifMatch parses the If-Match header (`"3"`, `W/"3"` or `3`).
func ifMatch(r *http.Request) (int64, *APIError) {
	h := strings.TrimSpace(r.Header.Get("If-Match"))
	if h == "" {
		return 0, NewError(http.StatusPreconditionRequired, "IF_MATCH_REQUIRED", "If-Match header is required.")
	}
	h = strings.Trim(strings.TrimPrefix(h, "W/"), `"`)
	v, err := strconv.ParseInt(h, 10, 64)
	if err != nil || v < 1 {
		return 0, NewError(http.StatusBadRequest, "INVALID_IF_MATCH", "If-Match must be a resource version.")
	}
	return v, nil
}

func setETag(w http.ResponseWriter, version int64) {
	w.Header().Set("ETag", fmt.Sprintf(`"%d"`, version))
}

func objectID(s string) (bson.ObjectID, *APIError) {
	id, err := bson.ObjectIDFromHex(s)
	if err != nil {
		return id, NewError(http.StatusNotFound, "NOT_FOUND", "Resource not found.")
	}
	return id, nil
}

// fail maps service errors to the API error envelope.
func fail(w http.ResponseWriter, err error) {
	var (
		ve *service.ValidationError
		re *service.RuleError
		ae *APIError
	)
	switch {
	case errors.As(err, &ae):
		WriteError(w, ae)
	case errors.As(err, &ve):
		fields := make(map[string]any, len(ve.Fields))
		for k, v := range ve.Fields {
			fields[k] = v
		}
		e := NewError(http.StatusBadRequest, "VALIDATION_ERROR", "Validation failed.")
		e.Details = map[string]any{"fields": fields}
		WriteError(w, e)
	case errors.As(err, &re):
		status := http.StatusUnprocessableEntity
		if re.Code == "INVALID_TRANSITION" {
			status = http.StatusConflict // spec §16.1
		}
		WriteError(w, NewError(status, re.Code, re.Message))
	case errors.Is(err, service.ErrForbidden):
		WriteError(w, NewError(http.StatusForbidden, "FORBIDDEN", "You are not allowed to do this."))
	case errors.Is(err, service.ErrNotFound):
		WriteError(w, NewError(http.StatusNotFound, "NOT_FOUND", "Resource not found."))
	case errors.Is(err, service.ErrVersionConflict):
		WriteError(w, NewError(http.StatusConflict, "VERSION_CONFLICT", "The resource was modified by someone else."))
	default:
		slog.Error("unhandled error", "error", err)
		WriteError(w, NewError(http.StatusInternalServerError, "INTERNAL", "Internal error."))
	}
}

// page is the cursor-paginated list envelope for lists that grow without
// bound (spec §16.1): batches, audit timelines, notifications.
type page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

func newPage[T any](items []T, next *bson.ObjectID) page[T] {
	if items == nil {
		items = []T{}
	}
	p := page[T]{Items: items}
	if next != nil {
		c := next.Hex()
		p.NextCursor = &c
	}
	return p
}

// list is the envelope of naturally bounded lists: no limit, cursor or nextCursor.
type list[T any] struct {
	Items []T `json:"items"`
}

func wholeList[T any](items []T) list[T] {
	if items == nil {
		items = []T{}
	}
	return list[T]{Items: items}
}

const (
	defaultLimit = 50
	maxLimit     = 100
)

// parseLimit implements spec §16.1: default 50, values above 100 clamp to 100,
// non-numeric or < 1 is 400 INVALID_LIMIT.
func parseLimit(r *http.Request) (int, *APIError) {
	v := r.URL.Query().Get("limit")
	if v == "" {
		return defaultLimit, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0, NewError(http.StatusBadRequest, "INVALID_LIMIT", "limit must be a positive integer.")
	}
	if n > maxLimit {
		n = maxLimit
	}
	return n, nil
}

// parseCursor reads the optional ?cursor= (an opaque object id).
func parseCursor(r *http.Request) (bson.ObjectID, error) {
	v := r.URL.Query().Get("cursor")
	if v == "" {
		return bson.ObjectID{}, nil
	}
	id, err := bson.ObjectIDFromHex(v)
	if err != nil {
		return id, service.Invalid("cursor", "invalid cursor")
	}
	return id, nil
}
