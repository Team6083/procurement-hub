package app

import "testing"

func TestHTTPVendors(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	w.do(t, call{token: buyer, method: "GET", path: "/api/v1/me"}).expect(200)

	body := func(name string, aliases ...string) map[string]any {
		a := make([]any, len(aliases))
		for i, x := range aliases {
			a[i] = x
		}
		return map[string]any{"name": name, "aliases": a, "defaultCurrency": "USD"}
	}
	w.do(t, call{token: w.mem, method: "POST", path: "/api/v1/vendors", body: body("Nope")}).expect(403, "forbidden")
	wcp := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("WCP", "West Coast Products")}).expect(201)
	rev := w.do(t, call{token: w.root, method: "POST", path: "/api/v1/vendors", body: body("REV")}).expect(201) // no aliases: must not collide
	w.do(t, call{token: w.root, method: "POST", path: "/api/v1/vendors", body: body("Other")}).expect(201)

	// Names and aliases are unique across vendors, in either role, ignoring case and spaces.
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body(" wcp ")}).expect(422, "vendor_name_taken")
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("Third", "rev")}).expect(422, "vendor_name_taken")
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("west coast products")}).expect(422, "vendor_name_taken")

	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/vendors"}).expect(200).Items()); n != 3 {
		t.Errorf("vendors = %d", n)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/vendors?q=west"}).expect(200).Items()); n != 1 {
		t.Errorf("alias search = %d", n)
	}
	// Deactivate with PUT + If-Match; inactive vendors are hidden unless requested.
	b := body("REV")
	b["active"] = false
	w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendors/{}", rev.String("id")), body: b, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendors/{}", rev.String("id")), ifMatch: rev.ETag(), body: b}).expect(200)
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/vendors"}).expect(200).Items()); n != 2 {
		t.Errorf("active vendors = %d", n)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/vendors?includeInactive=true"}).expect(200).Items()); n != 3 {
		t.Errorf("all vendors = %d", n)
	}

	// An item picks a vendor from the list (name copied) or uses free text.
	id, _ := w.openBatch(t, "Vendors")
	item := itemBody("pick")
	item["vendorId"] = wcp.String("id")
	it := w.do(t, call{token: w.mem, method: "POST", path: w.path("/batches/{}", id) + "/items", body: item}).expect(201)
	if it.String("vendorName") != "WCP" || it.String("vendorId") != wcp.String("id") {
		t.Errorf("item vendor: %s", it.Body)
	}
	free := itemBody("free")
	free["vendorName"] = "Local shop"
	it = w.do(t, call{token: w.mem, method: "POST", path: w.path("/batches/{}", id) + "/items", body: free}).expect(201)
	if it.String("vendorName") != "Local shop" || it.JSON()["vendorId"] != nil {
		t.Errorf("free-text vendor: %s", it.Body)
	}
	bad := itemBody("bad")
	bad["vendorId"] = "000000000000000000000001"
	w.do(t, call{token: w.mem, method: "POST", path: w.path("/batches/{}", id) + "/items", body: bad}).expect(400, "invalid_request")

	// Keys use Unicode case folding and NFC: Greek final sigma, and composed vs decomposed é.
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("ΟΔΟΣ", "Caf\u00e9")}).expect(201)
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("οδος")}).expect(422, "vendor_name_taken")
	w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: body("cafe\u0301")}).expect(422, "vendor_name_taken")
}
