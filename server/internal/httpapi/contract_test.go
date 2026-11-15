package httpapi

import (
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

// TestRoutesMatchOpenAPI keeps api/openapi.yaml honest: every route the server
// registers must be documented and every documented operation must exist.
func TestRoutesMatchOpenAPI(t *testing.T) {
	raw, err := os.ReadFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	documented := map[string]bool{}
	for path, ops := range doc.Paths {
		for method := range ops {
			switch m := strings.ToUpper(method); m {
			case "GET", "POST", "PUT", "PATCH", "DELETE":
				documented[m+" /api/v1"+path] = true
			}
		}
	}

	r := chi.NewRouter()
	MountMeta(r, MetaInfo{})
	r.Route("/api/v1", func(r chi.Router) {
		(&TeamsAPI{}).Mount(r)
		(&MeAPI{}).Mount(r)
		(&BatchesAPI{}).Mount(r)
		(&OrdersAPI{}).Mount(r)
	})
	registered := map[string]bool{}
	err = chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		registered[method+" "+strings.ReplaceAll(route, "/*", "")] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	diff := func(a, b map[string]bool) []string {
		var out []string
		for k := range a {
			if !b[k] {
				out = append(out, k)
			}
		}
		sort.Strings(out)
		return out
	}
	if missing := diff(registered, documented); len(missing) > 0 {
		t.Errorf("routes missing from api/openapi.yaml:\n  %s", strings.Join(missing, "\n  "))
	}
	if stale := diff(documented, registered); len(stale) > 0 {
		t.Errorf("operations in api/openapi.yaml with no route:\n  %s", strings.Join(stale, "\n  "))
	}
	if len(registered) < 30 {
		t.Errorf("suspiciously few routes registered: %d", len(registered))
	}
}
