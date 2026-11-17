package app

import (
	"sync"
	"testing"
)

// receivingFixture is a placed vendor order of one line (quantity 2, price 5).
type receivingFixture struct {
	buyer, recv         string
	batchID, itemID     string
	orderID, lineID     string
	orderPath, vendorID string
}

func (w *world) placedOrder(t *testing.T) *receivingFixture {
	t.Helper()
	f := &receivingFixture{}
	f.buyer = w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	f.recv = w.userWithRoles(t, "recv", false, []string{"receiver"})
	vendor := w.do(t, call{token: f.buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	f.vendorID = vendor.String("id")
	batchID, items := w.confirmedBatch(t, "Round 1", "motor")
	f.batchID, f.itemID = batchID, items[0]
	o := w.do(t, call{token: f.buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": f.vendorID, "itemIds": items}}).expect(201)
	l := o.JSON()["lines"].([]any)[0].(map[string]any)
	f.lineID, f.orderID = l["id"].(string), o.String("id")
	f.orderPath = w.path("/vendor-orders/{}", f.orderID)
	o = w.do(t, call{token: f.buyer, method: "PUT", path: w.path("/vendor-order-lines/{}", f.lineID), ifMatch: o.ETag(), body: map[string]any{
		"teamId": l["teamId"], "name": l["name"], "quantity": l["quantity"], "unitPrice": "5.00"}}).expect(200)
	w.do(t, call{token: f.buyer, method: "POST", path: f.orderPath + "/place", ifMatch: o.ETag()}).expect(200)
	return f
}

func (w *world) order(t *testing.T, f *receivingFixture) map[string]any {
	t.Helper()
	return w.do(t, call{token: f.buyer, method: "GET", path: f.orderPath}).expect(200).JSON()
}

func (w *world) orderLine(t *testing.T, f *receivingFixture) map[string]any {
	return w.order(t, f)["lines"].([]any)[0].(map[string]any)
}

func (w *world) batchStatus(t *testing.T, f *receivingFixture) string {
	return w.do(t, call{token: w.adm, method: "GET", path: w.path("/batches/{}", f.batchID)}).expect(200).String("status")
}

// Receiving happy path: deliver, match with a damaged unit, resolve, undo.
func TestHTTPDeliveryFlow(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)

	// Receiving data does not exist for regular users.
	for _, p := range []string{"/api/v1/deliveries", "/api/v1/delivery-lines", "/api/v1/problems"} {
		w.do(t, call{token: w.mem, method: "GET", path: p}).expect(404, "not_found")
	}
	w.do(t, call{token: w.mem, method: "POST", path: "/api/v1/deliveries", body: map[string]any{"lines": []map[string]any{{"name": "x", "goodQuantity": 1}}}}).expect(404, "not_found")
	w.do(t, call{token: w.root, method: "POST", path: "/api/v1/deliveries", body: map[string]any{"lines": []map[string]any{{"name": "x", "goodQuantity": 1}}}}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "GET", path: "/api/v1/deliveries"}).expect(200)

	cands := w.do(t, call{token: f.recv, method: "GET", path: "/api/v1/purchasing/match-candidates?name=motor"}).expect(200).Items()
	if len(cands) != 1 || cands[0].(map[string]any)["capacity"] != float64(2) {
		t.Fatalf("candidates = %v", cands)
	}

	// One good and one damaged unit, matched on the spot.
	d := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
		"source": "WCP", "lines": []map[string]any{{"name": "motor", "goodQuantity": 1, "problemQuantity": 1, "problemType": "damaged",
			"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 1, "problemQuantity": 1}}}}}}).expect(201)
	dl := d.JSON()["lines"].([]any)[0].(map[string]any)
	if dl["matchState"] != "matched" {
		t.Fatalf("delivery line: %v", dl)
	}
	ol := w.orderLine(t, f)
	if ol["receivedQuantity"] != float64(1) || ol["openProblemQuantity"] != float64(1) || ol["status"] != "partially_received" {
		t.Fatalf("order line after delivery: %v", ol)
	}
	if st := w.batchStatus(t, f); st != "receiving" {
		t.Errorf("batch = %s", st)
	}
	if got := w.do(t, call{token: f.buyer, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["openProblems"].(map[string]any)["count"]; got != float64(1) {
		t.Errorf("openProblems = %v", got)
	}
	problems := w.do(t, call{token: f.buyer, method: "GET", path: "/api/v1/problems?status=open"}).expect(200).Items()
	if len(problems) != 1 {
		t.Fatalf("problems = %v", problems)
	}
	pr := problems[0].(map[string]any)

	// Unplace is blocked by the delivery and the problem.
	b := w.do(t, call{token: f.buyer, method: "POST", path: f.orderPath + "/unplace", ifMatch: `"` + itoa(int(w.order(t, f)["version"].(float64))) + `"`,
		body: map[string]any{"reason": "oops"}}).expect(409, "blocked_by_dependency")
	types := map[string]bool{}
	for _, bl := range b.JSON()["error"].(map[string]any)["details"].(map[string]any)["blockers"].([]any) {
		types[bl.(map[string]any)["type"].(string)] = true
	}
	if !types["delivery"] || !types["problem"] {
		t.Errorf("blockers = %v", types)
	}

	// Receivers cannot settle problems; purchasers accept the damaged unit: the line completes.
	pp := w.path("/problems/{}", pr["id"].(string))
	w.do(t, call{token: f.recv, method: "POST", path: pp + "/resolve", ifMatch: `"` + itoa(int(pr["version"].(float64))) + `"`, body: map[string]any{"action": "accept"}}).expect(403, "forbidden")
	w.do(t, call{token: f.buyer, method: "POST", path: pp + "/resolve", ifMatch: `"` + itoa(int(pr["version"].(float64))) + `"`,
		body: map[string]any{"action": "accept", "refundBase": "1"}}).expect(400, "invalid_request")
	r := w.do(t, call{token: f.buyer, method: "POST", path: pp + "/resolve", ifMatch: `"` + itoa(int(pr["version"].(float64))) + `"`, body: map[string]any{"action": "accept"}}).expect(200)
	if ol := w.orderLine(t, f); ol["status"] != "received" || ol["receivedQuantity"] != float64(2) {
		t.Fatalf("line after accept: %v", ol)
	}
	if st := w.batchStatus(t, f); st != "completed" {
		t.Errorf("batch should be completed: %s", st)
	}

	// Undo the resolution, then resolve as return with a refund.
	r = w.do(t, call{token: f.buyer, method: "POST", path: pp + "/unresolve", ifMatch: r.ETag(), body: map[string]any{"reason": "wrong call"}}).expect(200)
	if st := w.batchStatus(t, f); st != "receiving" {
		t.Errorf("batch should be receiving again: %s", st)
	}
	r = w.do(t, call{token: f.buyer, method: "POST", path: pp + "/resolve", ifMatch: r.ETag(), body: map[string]any{"action": "return_no_replace", "refundBase": "5"}}).expect(200)
	o := w.order(t, f)
	if n := len(o["ledger"].([]any)); n != 1 || o["ledger"].([]any)[0].(map[string]any)["amountBase"] != "-5" || o["invariantOk"] != true {
		t.Fatalf("ledger after refund: %v", o["ledger"])
	}
	if ol := w.orderLine(t, f); ol["status"] != "received" || ol["expectedQuantity"] != float64(1) {
		t.Fatalf("line after return: %v", ol)
	}
	w.do(t, call{token: f.buyer, method: "POST", path: pp + "/unresolve", ifMatch: r.ETag(), body: map[string]any{"reason": "undo"}}).expect(200)
	if e := w.order(t, f)["ledger"].([]any)[0].(map[string]any); e["voided"] == nil {
		t.Errorf("refund entry should be voided: %v", e)
	}

	// Voiding the delivery voids its match and the open problem; the line is open again.
	dp := w.path("/deliveries/{}", d.String("id"))
	cur := w.do(t, call{token: f.recv, method: "GET", path: dp}).expect(200)
	w.do(t, call{token: f.recv, method: "POST", path: dp + "/void", ifMatch: cur.ETag(), body: map[string]any{"reason": "wrong box"}}).expect(200)
	if ol := w.orderLine(t, f); ol["receivedQuantity"] != float64(0) || ol["openProblemQuantity"] != float64(0) || ol["status"] != "ordered" {
		t.Fatalf("line after void: %v", ol)
	}
	if n := len(w.do(t, call{token: f.buyer, method: "GET", path: "/api/v1/problems"}).expect(200).Items()); n != 0 {
		t.Errorf("voided problems still listed: %d", n)
	}

	// An over-delivery stays pending and is marked as needing no match.
	d2 := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
		"lines": []map[string]any{{"name": "motor", "goodQuantity": 3}}}}).expect(201)
	dl2 := d2.JSON()["lines"].([]any)[0].(map[string]any)
	m := w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", dl2["id"].(string)), ifMatch: d2.ETag(),
		body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 3, "problemQuantity": 0}}}}).expect(422, "line_quantity_exceeded")
	if got := m.JSON()["error"].(map[string]any)["details"].(map[string]any)["remaining"]; got != float64(2) {
		t.Errorf("remaining = %v", got)
	}
	m = w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", dl2["id"].(string)), ifMatch: d2.ETag(),
		body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 2, "problemQuantity": 0}}}}).expect(200)
	if m.JSON()["lines"].([]any)[0].(map[string]any)["matchState"] != "partial" {
		t.Errorf("expected partial: %s", m.Body)
	}
	if n := len(w.do(t, call{token: f.recv, method: "GET", path: "/api/v1/delivery-lines"}).expect(200).Items()); n != 1 {
		t.Errorf("pending lines = %d", n)
	}
	m = w.do(t, call{token: f.recv, method: "POST", path: w.path("/delivery-lines/{}/no-match", dl2["id"].(string)), ifMatch: m.ETag(), body: map[string]any{"reason": "vendor sent extra"}}).expect(200)
	if m.JSON()["lines"].([]any)[0].(map[string]any)["matchState"] != "not_needed" {
		t.Errorf("expected not_needed: %s", m.Body)
	}
	if n := len(w.do(t, call{token: f.recv, method: "GET", path: "/api/v1/delivery-lines"}).expect(200).Items()); n != 0 {
		t.Errorf("pending lines after no-match = %d", n)
	}
	w.do(t, call{token: f.recv, method: "POST", path: w.path("/delivery-lines/{}/no-match/undo", dl2["id"].(string)), ifMatch: m.ETag(), body: map[string]any{"reason": "oops"}}).expect(200)
	tl := w.do(t, call{token: f.recv, method: "GET", path: "/api/v1/audit?objectType=delivery&objectId=" + d2.String("id")}).expect(200).Items()
	if len(tl) < 4 {
		t.Errorf("delivery timeline events = %d", len(tl))
	}
	w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/audit?objectType=delivery&objectId=" + d2.String("id")}).expect(404, "not_found")
}

// Two boxes matched at the same time to a line that cannot take both: exactly
// one succeeds, the other gets 422 line_quantity_exceeded (spec §10).
func TestHTTPConcurrentMatchesRespectLineQuantity(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)
	type target struct{ lineID, version string }
	var ts []target
	for i := 0; i < 2; i++ {
		d := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
			"lines": []map[string]any{{"name": "motor", "goodQuantity": 2}}}}).expect(201)
		ts = append(ts, target{d.JSON()["lines"].([]any)[0].(map[string]any)["id"].(string), d.ETag()})
	}
	codes := make([]int, len(ts))
	var wg sync.WaitGroup
	for i := range ts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", ts[i].lineID), ifMatch: ts[i].version,
				body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 2, "problemQuantity": 0}}}}).Status
		}()
	}
	wg.Wait()
	if (codes[0] != 200 || codes[1] != 422) && (codes[0] != 422 || codes[1] != 200) {
		t.Fatalf("status codes = %v, want one 200 and one 422", codes)
	}
	if ol := w.orderLine(t, f); ol["receivedQuantity"] != float64(2) {
		t.Errorf("received = %v", ol["receivedQuantity"])
	}
}
