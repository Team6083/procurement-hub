package app

import "testing"

// Item-level undo operations: copy a withdrawn item, undo a review decision
// and undo an unpurchasable mark.
func TestHTTPItemUndoOperations(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})

	// Copy a withdrawn item into the same batch.
	id, _ := w.openBatch(t, "Round 1")
	bp := w.path("/batches/{}", id)
	a := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("a")}).expect(201)
	wd := w.do(t, call{token: w.mem, method: "POST", path: w.path("/items/{}", a.String("id")) + "/withdraw", ifMatch: a.ETag()}).expect(200)
	cp := w.do(t, call{token: w.mem, method: "POST", path: w.path("/items/{}", a.String("id")) + "/copy", ifMatch: wd.ETag()}).expect(201)
	if cp.String("id") == a.String("id") || cp.String("name") != "a" {
		t.Fatalf("copy = %s", cp.Body)
	}

	// Undo a review decision while the batch is still reviewing.
	b := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "close"}}).expect(200)
	w.do(t, call{token: w.appr, method: "POST", path: bp + "/reviews", body: map[string]any{"decisions": []map[string]any{
		{"itemId": cp.String("id"), "decision": "reject", "comment": "no"}}}}).expect(200)
	cur := w.item(t, id, cp.String("id"))
	w.do(t, call{token: w.appr, method: "POST", path: w.path("/items/{}", cp.String("id")) + "/review/undo",
		ifMatch: `"` + itoa(int(cur["version"].(float64))) + `"`, body: map[string]any{"reason": "changed my mind"}}).expect(200)
	if got := w.item(t, id, cp.String("id"))["status"]; got != "pending" {
		t.Errorf("status after review undo = %v", got)
	}

	// Mark an approved item unpurchasable, then undo the mark.
	bid, items := w.confirmedBatch(t, "Round 2", "motor")
	it := w.item(t, bid, items[0])
	ip := w.path("/items/{}", items[0])
	m := w.do(t, call{token: buyer, method: "POST", path: ip + "/unpurchasable",
		ifMatch: `"` + itoa(int(it["version"].(float64))) + `"`, body: map[string]any{"reason": "gone"}}).expect(200)
	w.do(t, call{token: buyer, method: "POST", path: ip + "/unpurchasable/undo", ifMatch: m.ETag(), body: map[string]any{"reason": "back in stock"}}).expect(200)
	if got := w.item(t, bid, items[0])["unpurchasable"]; got != nil {
		t.Errorf("unpurchasable mark left: %v", got)
	}
}

// Draft order line removal and order cancel/uncancel.
func TestHTTPDraftLineDeleteAndUncancel(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	_, items := w.confirmedBatch(t, "Round 1", "motor", "wheel")
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{
		"vendorId": vendor.String("id"), "itemIds": items}}).expect(201)
	op := w.path("/vendor-orders/{}", o.String("id"))
	l := o.JSON()["lines"].([]any)[0].(map[string]any)
	o = w.do(t, call{token: buyer, method: "DELETE", path: w.path("/vendor-order-lines/{}", l["id"].(string)), ifMatch: o.ETag()}).expect(200)
	if n := len(o.JSON()["lines"].([]any)); n != 1 {
		t.Fatalf("lines after delete = %d", n)
	}
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/cancel", ifMatch: o.ETag(), body: map[string]any{"reason": "not needed"}}).expect(200)
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/uncancel", ifMatch: o.ETag(), body: map[string]any{"reason": "needed after all"}}).expect(200)
	if o.String("status") != "draft" {
		t.Errorf("status after uncancel = %s", o.String("status"))
	}
}

// A short line is closed and reopened; delivery lines list match suggestions.
func TestHTTPCloseReopenLineAndSuggestions(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)
	d := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
		"lines": []map[string]any{{"name": "motor", "goodQuantity": 1}}}}).expect(201)
	dl := d.JSON()["lines"].([]any)[0].(map[string]any)
	sug := w.do(t, call{token: f.recv, method: "GET", path: w.path("/delivery-lines/{}/suggestions", dl["id"].(string))}).expect(200).Items()
	if len(sug) != 1 {
		t.Fatalf("suggestions = %v", sug)
	}
	w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", dl["id"].(string)), ifMatch: d.ETag(),
		body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 1, "problemQuantity": 0}}}}).expect(200)

	lp := w.path("/vendor-order-lines/{}", f.lineID)
	o := w.do(t, call{token: f.buyer, method: "GET", path: f.orderPath}).expect(200)
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), body: map[string]any{
		"type": "short_accepted", "reason": "vendor shipped one"}}).expect(200)
	if ol := o.JSON()["lines"].([]any)[0].(map[string]any); ol["closure"] == nil {
		t.Fatalf("line not closed: %v", ol)
	}
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/reopen", ifMatch: o.ETag(), body: map[string]any{"reason": "more coming"}}).expect(200)
	if ol := o.JSON()["lines"].([]any)[0].(map[string]any); ol["closure"] != nil {
		t.Errorf("line still closed: %v", ol)
	}
}
