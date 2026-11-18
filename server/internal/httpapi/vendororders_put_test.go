package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// PUT replaces every editable field, so ownerIds is required (spec §16.1, §16.2).
func TestPutVendorOrderRequiresOwnerIDs(t *testing.T) {
	r := chi.NewRouter()
	r.Put("/vendor-orders/{id}", (&VendorOrdersAPI{}).put)
	body := `{"vendorId":"` + bson.NewObjectID().Hex() + `","currency":"USD"}`
	req := httptest.NewRequest(http.MethodPut, "/vendor-orders/"+bson.NewObjectID().Hex(), strings.NewReader(body))
	req.Header.Set("If-Match", `"1"`)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_request") {
		t.Fatalf("missing ownerIds: %d %s", w.Code, w.Body.String())
	}
}
