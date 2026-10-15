package httpapi

import (
	"bytes"
	"encoding/json"
	"time"

	"github.com/OWNER/procurement-hub/internal/domain"
)

// optionalRole distinguishes an absent field, an explicit null, and a value.
type optionalRole struct {
	Set  bool
	Null bool
	Role domain.Role
}

func (o *optionalRole) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.Role)
}

// optionalTime distinguishes absent, explicit null, and a timestamp.
type optionalTime struct {
	Set   bool
	Value *time.Time
}

func (o *optionalTime) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return nil
	}
	var t time.Time
	if err := json.Unmarshal(b, &t); err != nil {
		return err
	}
	t = t.UTC()
	o.Value = &t
	return nil
}

// optionalString distinguishes absent, explicit null (clear) and a string.
type optionalString struct {
	Set   bool
	Value string
}

func (o *optionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		return nil
	}
	return json.Unmarshal(b, &o.Value)
}
