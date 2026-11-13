package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// /api/v1/meta must stay unauthenticated while the rest of /api/v1 requires a token.
func TestMetaIsPublicOthersRequireAuth(t *testing.T) {
	r := chi.NewRouter()
	r.Use(VersionHeaders(Version{Version: "v1", Commit: "abc"}))
	MountMeta(r, MetaInfo{BaseCurrency: "TWD", SupportedCurrencies: []string{"TWD"}})
	var sawAdmin bool
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(Authenticate(fakeVerifier{err: ErrTest}, fakeProv{}, fakeML{&sawAdmin}))
		r.Get("/me", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/meta", nil))
	if rec.Code != 200 || rec.Header().Get("X-App-Commit") != "abc" {
		t.Fatalf("meta: code=%d headers=%v", rec.Code, rec.Header())
	}
	for _, path := range []string{"/api/v1/me", "/api/v1/teams", "/api/v1/nope"} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 401 {
			t.Errorf("%s without token: got %d want 401", path, rec.Code)
		}
	}
}

func TestCORSPreflight(t *testing.T) {
	h := CORS([]string{"https://app.example.org"})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))

	req := httptest.NewRequest("OPTIONS", "/api/v1/me", nil)
	req.Header.Set("Origin", "https://app.example.org")
	req.Header.Set("Access-Control-Request-Method", "PATCH")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") != "https://app.example.org" ||
		rec.Header().Get("Access-Control-Allow-Headers") != "Authorization, Content-Type, If-Match" ||
		rec.Header().Get("Access-Control-Max-Age") != "600" || rec.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}

	req = httptest.NewRequest("GET", "/api/v1/me", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("disallowed origin was echoed")
	}
}
