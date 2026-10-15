package httpapi

import (
	"encoding/json"
	"net/http"
)

// APIError is the uniform error envelope (spec §16.1).
type APIError struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

func NewError(status int, code, msg string) *APIError {
	return &APIError{Status: status, Code: code, Message: msg}
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func WriteError(w http.ResponseWriter, e *APIError) {
	if e.Details == nil {
		e.Details = map[string]any{}
	}
	WriteJSON(w, e.Status, map[string]any{"error": e})
}
