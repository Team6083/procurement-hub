package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOptionalFieldsDistinguishAbsentNullValue(t *testing.T) {
	type body struct {
		Role optionalRole   `json:"role"`
		When optionalTime   `json:"when"`
		Vis  optionalString `json:"vis"`
	}
	var absent body
	if err := json.Unmarshal([]byte(`{}`), &absent); err != nil {
		t.Fatal(err)
	}
	if absent.Role.Set || absent.When.Set || absent.Vis.Set {
		t.Fatalf("absent fields reported as set: %+v", absent)
	}

	var null body
	if err := json.Unmarshal([]byte(`{"role":null,"when":null,"vis":null}`), &null); err != nil {
		t.Fatal(err)
	}
	if !null.Role.Set || !null.Role.Null || !null.When.Set || null.When.Value != nil || !null.Vis.Set || null.Vis.Value != "" {
		t.Fatalf("explicit null not detected: %+v", null)
	}

	var val body
	if err := json.Unmarshal([]byte(`{"role":"admin","when":"2030-01-02T03:04:05+08:00","vis":"members"}`), &val); err != nil {
		t.Fatal(err)
	}
	if val.Role.Null || val.Role.Role != "admin" || val.When.Value == nil || val.When.Value.Hour() != 19 || val.Vis.Value != "members" {
		t.Fatalf("values wrong: %+v", val)
	}
	if err := json.Unmarshal([]byte(`{"when":"yesterday"}`), &val); err == nil {
		t.Fatal("bad timestamp should fail")
	}
}

func TestIfMatchParsing(t *testing.T) {
	for in, want := range map[string]int64{`"3"`: 3, `W/"7"`: 7, `12`: 12} {
		r := newReq(t, in)
		got, e := ifMatch(r)
		if e != nil || got != want {
			t.Errorf("%q: got %d,%v want %d", in, got, e, want)
		}
	}
	for _, in := range []string{``, `abc`, `0`, `-1`} {
		if _, e := ifMatch(newReq(t, in)); e == nil {
			t.Errorf("%q: expected error", in)
		}
	}
	if _, e := ifMatch(newReq(t, "")); e == nil || e.Status != 428 {
		t.Errorf("missing If-Match should be 428, got %+v", e)
	}
}

func newReq(t *testing.T, ifm string) *http.Request {
	t.Helper()
	r := httptest.NewRequest("PATCH", "/x", nil)
	if ifm != "" {
		r.Header.Set("If-Match", ifm)
	}
	return r
}
