package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPLookup(t *testing.T) {
	pf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("q") {
		case "WCP-1":
			_, _ = w.Write([]byte(`{"name":"Motor","store":" west coast PRODUCTS ","sku":"WCP-1","url":"https://x/y","inStock":true,"price":"12.345"}`))
		case "UNKNOWN-STORE":
			_, _ = w.Write([]byte(`{"name":"Gadget","store":"Corner Shop","sku":"G-1","url":"","price":3}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(pf.Close)

	w := setupWith(t, map[string]string{"LOOKUP_PROVIDER": "partfinder", "PARTFINDER_URL": pf.URL})
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors",
		body: map[string]any{"name": "WCP", "aliases": []string{"West Coast Products"}, "defaultCurrency": "USD"}}).expect(201)

	// Matched through an alias, case-insensitively; the price is rounded to the currency's minor unit.
	got := w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/lookup?q=WCP-1"}).expect(200)
	if got.String("vendorId") != vendor.String("id") || got.String("vendorName") != "WCP" || got.String("name") != "Motor" ||
		got.String("unitPrice", "amount") != "12.35" || got.String("unitPrice", "currency") != "USD" {
		t.Errorf("matched lookup: %s", got.Body)
	}
	// An unknown store keeps its name and no vendorId.
	got = w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/lookup?q=UNKNOWN-STORE"}).expect(200)
	if got.JSON()["vendorId"] != nil || got.String("vendorName") != "Corner Shop" {
		t.Errorf("unmatched lookup: %s", got.Body)
	}
	w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/lookup?q=nothing"}).expect(404, "lookup_not_found")
	w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/lookup", skipRequestValidation: true}).expect(400, "invalid_request")

	off := setup(t)
	off.do(t, call{token: off.mem, method: "GET", path: "/api/v1/lookup?q=x"}).expect(503, "lookup_disabled")
}
