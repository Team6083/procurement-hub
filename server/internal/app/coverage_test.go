package app

import (
	"fmt"
	"os"
	"sort"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/team6083/procurement-hub/server/internal/mongotest"
)

var (
	hitMu sync.Mutex
	hits  = map[string]bool{}
)

func recordHit(method, path string) {
	hitMu.Lock()
	hits[method+" "+path] = true
	hitMu.Unlock()
}

// TestMain provides the MongoDB replica set (package mongotest) and reports which OpenAPI operations the HTTP-level tests exercised.
// It is informational; set HTTP_COVERAGE_STRICT=1 to fail when any is missed.
func TestMain(m *testing.M) {
	code := mongotest.Main(m)
	if mongotest.Used() && code == 0 {
		doc, err := openapi3.NewLoader().LoadFromFile("../../../api/openapi.yaml")
		if err == nil {
			var missed []string
			total := 0
			for path, item := range doc.Paths.Map() {
				for method := range item.Operations() {
					total++
					if !hits[method+" "+path] {
						missed = append(missed, method+" "+path)
					}
				}
			}
			sort.Strings(missed)
			fmt.Printf("HTTP contract coverage: %d/%d operations exercised\n", total-len(missed), total)
			for _, k := range missed {
				fmt.Println("  not exercised:", k)
			}
			if len(missed) > 0 && os.Getenv("HTTP_COVERAGE_STRICT") == "1" {
				code = 1
			}
		}
	}
	os.Exit(code)
}
