package app

import (
	"testing"
)

// receivingBatch takes a batch to `receiving`: the given items are ordered
// from one vendor in one external order (USD 10 per unit, charged
// TWD 32.5 per USD, no shipping), so unit costs are whole TWD. buyer is the
// purchaser and mem (w.memID) the receiver. Returns the batch, the items, the
// team order and the external order.
func (w *orderWorld) receivingBatch(t *testing.T, items ...string) (batch string, ids []string, order map[string]any, tx *result) {
	t.Helper()
	batch, ids = w.orderingBatch(t, w.teamID, []string{w.buyerID}, items...)
	o := w.createOrder(t, w.buyer, batch, "Acme", ids...).expect(201)
	tx = w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: map[string]any{
		"orderIds": []string{o.String("id")}, "currency": "USD"}}).expect(201)
	var prices []map[string]any
	var units int
	for i, spec := range items {
		_, qty, _ := cutColon(spec)
		units += atoi(qty)
		prices = append(prices, map[string]any{"itemId": ids[i], "actualUnitPrice": map[string]any{"amount": "10", "currency": "USD"}})
	}
	charged := itoa(units * 325) // 10 USD per unit at 32.5 TWD per USD
	tx = w.do(t, call{token: w.buyer, method: "PATCH", path: w.path("/vendor-transactions/{}", tx.String("id")), ifMatch: tx.ETag(),
		body: map[string]any{"itemPrices": prices, "chargedAmountBase": charged}}).expect(200)
	w.do(t, call{token: w.buyer, method: "POST", path: w.path("/vendor-transactions/{}/place", tx.String("id")), ifMatch: tx.ETag()}).expect(200)
	if s := w.batchStatus(t, batch); s != "receiving" {
		t.Fatalf("batch = %s, want receiving", s)
	}
	return batch, ids, w.orderOf(t, w.buyer, batch, o.String("id")), tx
}

func cutColon(s string) (string, string, bool) {
	for i := range s {
		if s[i] == ':' {
			return s[:i], s[i+1:], true
		}
	}
	return s, "", false
}

// quoted returns the item's current version as an If-Match value.
func (w *orderWorld) itemVer(t *testing.T, batch, id string) string {
	t.Helper()
	return `"` + itoa(int(w.itemOf(t, batch, id)["version"].(float64))) + `"`
}

func (w *orderWorld) orderVer(t *testing.T, batch string, order map[string]any) string {
	t.Helper()
	return `"` + itoa(int(w.orderOf(t, w.buyer, batch, str(order, "id"))["version"].(float64))) + `"`
}

// Acceptance criterion 6: partial receipt, damage exception, refund
// disposition; the batch completes only once every item is closed and the
// cost figures reflect the refund.
func TestHTTPReceivingAcceptance6(t *testing.T) {
	w := setupOrders(t)
	batch, items, order, _ := w.receivingBatch(t, "a:3", "b:1")
	a, b := items[0], items[1]
	ip := func(id, suffix string) string { return w.path("/items/{}/"+suffix, id) }
	requireDecimal(t, "order total before", str(order, "totalBase"), "1300")

	// Tasks: the receiver has 2 items to receive, the buyer has no exception yet.
	taskCount := func(token, key string) float64 {
		for _, tk := range w.do(t, call{token: token, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()[key].([]any) {
			m := tk.(map[string]any)
			if m["batch"].(map[string]any)["id"] == batch {
				return m["count"].(float64)
			}
		}
		return 0
	}
	if n := taskCount(w.mem, "itemsToReceive"); n != 2 {
		t.Errorf("itemsToReceive = %v", n)
	}
	if n := taskCount(w.buyer, "openExceptions"); n != 0 {
		t.Errorf("openExceptions = %v", n)
	}

	// Short delivery of a: 1 of 3.
	rc := w.do(t, call{token: w.mem, method: "POST", path: ip(a, "receipts"), ifMatch: w.itemVer(t, batch, a),
		body: map[string]any{"quantity": 1, "note": "box 1"}}).expect(201)
	if rc.String("item", "status") != "partially_received" || rc.JSON()["item"].(map[string]any)["receivedQuantity"].(float64) != 1 ||
		rc.String("batch", "status") != "receiving" || rc.JSON()["receipt"].(map[string]any)["quantity"].(float64) != 1 {
		t.Fatalf("receipt = %s", rc.Body)
	}
	if rc.Header.Get("ETag") != w.itemVer(t, batch, a) {
		t.Errorf("ETag %s is not the item's version", rc.Header.Get("ETag"))
	}
	list := w.do(t, call{token: w.outsider, method: "GET", path: ip(a, "receipts")}).expect(200).Items()
	if len(list) != 1 || list[0].(map[string]any)["note"] != "box 1" {
		t.Fatalf("receipts = %v", list)
	}
	// b arrives completely; the batch is still waiting for a.
	rb := w.do(t, call{token: w.mem, method: "POST", path: ip(b, "receipts"), ifMatch: w.itemVer(t, batch, b), body: map[string]any{"quantity": 1}}).expect(201)
	if rb.String("item", "status") != "received" || rb.String("batch", "status") != "receiving" {
		t.Fatalf("b = %s", rb.Body)
	}

	// The receiver reports the damage on a.
	x := w.do(t, call{token: w.mem, method: "POST", path: ip(a, "exceptions"), ifMatch: w.itemVer(t, batch, a),
		body: map[string]any{"type": "damaged", "description": "two units crushed"}}).expect(201)
	if x.String("item", "status") != "exception" || x.JSON()["exception"].(map[string]any)["resolution"] != nil || x.JSON()["adjustment"] != nil {
		t.Fatalf("exception = %s", x.Body)
	}
	excID := x.String("exception", "id")
	if n := taskCount(w.buyer, "openExceptions"); n != 1 {
		t.Errorf("openExceptions = %v, want 1", n)
	}
	if n := taskCount(w.mem, "itemsToReceive"); n != 0 {
		t.Errorf("itemsToReceive = %v, want 0", n)
	}
	// While the exception is open nothing more is received and the batch stays.
	w.do(t, call{token: w.mem, method: "POST", path: ip(a, "receipts"), ifMatch: w.itemVer(t, batch, a), body: map[string]any{"quantity": 1}}).expect(409, "invalid_transition")
	if s := w.batchStatus(t, batch); s != "receiving" {
		t.Fatalf("batch = %s", s)
	}
	ex := w.do(t, call{token: w.outsider, method: "GET", path: ip(a, "exceptions")}).expect(200).Items()
	if len(ex) != 1 || ex[0].(map[string]any)["id"] != excID {
		t.Fatalf("exceptions = %v", ex)
	}

	// The purchaser refunds TWD 200 and accepts the short delivery: a closes, so does the batch.
	rp := w.path("/exceptions/{}/resolve", excID)
	excVer := `"` + itoa(int(x.JSON()["exception"].(map[string]any)["version"].(float64))) + `"`
	res := w.do(t, call{token: w.buyer, method: "POST", path: rp, ifMatch: excVer,
		body: map[string]any{"action": "accept", "note": "keep what arrived", "refundAmountBase": "200"}}).expect(200)
	if res.String("item", "status") != "accepted_short" || res.String("item", "closeReason") != "keep what arrived" ||
		res.String("batch", "status") != "completed" || res.String("exception", "resolution", "action") != "accept" {
		t.Fatalf("resolve = %s", res.Body)
	}
	requireDecimal(t, "refund", res.String("exception", "resolution", "refundAmountBase"), "200")
	requireDecimal(t, "adjustment", res.String("adjustment", "amountBase"), "-200")
	if res.String("adjustment", "itemId") != a || res.Header.Get("ETag") != `"2"` {
		t.Errorf("adjustment = %s, ETag %s", res.Body, res.Header.Get("ETag"))
	}
	if s := w.batchStatus(t, batch); s != "completed" {
		t.Fatalf("batch = %s, want completed", s)
	}
	// The cost figures reflect the refund: items stay as billed, adjustments and total move.
	o := w.orderOf(t, w.buyer, batch, str(order, "id"))
	requireDecimal(t, "itemsCostBase", str(o, "itemsCostBase"), "1300")
	requireDecimal(t, "adjustmentsBase", str(o, "adjustmentsBase"), "-200")
	requireDecimal(t, "totalBase", str(o, "totalBase"), "1100")
	if n := taskCount(w.buyer, "openExceptions"); n != 0 {
		t.Errorf("openExceptions = %v after completion", n)
	}

	// The batch timeline tells the story, ending with the automatic completion.
	var actions []string
	for _, e := range w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/audit?objectType=batch&objectId=" + batch + "&limit=100"}).expect(200).Items() {
		actions = append(actions, e.(map[string]any)["action"].(string))
	}
	seen := map[string]bool{}
	for _, a := range actions {
		seen[a] = true
	}
	for _, want := range []string{"item.received", "item.exception_reported", "item.exception_resolved", "order.adjusted", "batch.auto_transition"} {
		if !seen[want] {
			t.Errorf("batch timeline lacks %s: %v", want, actions)
		}
	}
	if actions[len(actions)-1] != "batch.auto_transition" {
		t.Errorf("timeline should end with the completion: %v", actions)
	}
}

// Request validation, If-Match, roles and visibility of the receiving endpoints.
func TestHTTPReceivingRulesAndRoles(t *testing.T) {
	w := setupOrders(t)
	batch, items, order, _ := w.receivingBatch(t, "a:2", "b:2")
	a, b := items[0], items[1]
	rcpt := func(token, id string, ifMatch string, body map[string]any) *result {
		return w.do(t, call{token: token, method: "POST", path: w.path("/items/{}/receipts", id), ifMatch: ifMatch, body: body, skipRequestValidation: true})
	}
	ver := func(id string) string { return w.itemVer(t, batch, id) }

	// If-Match is required, and checked.
	rcpt(w.mem, a, "", map[string]any{"quantity": 1}).expect(428, "if_match_required")
	rcpt(w.mem, a, `"x"`, map[string]any{"quantity": 1}).expect(400, "invalid_if_match")
	rcpt(w.mem, a, `"99"`, map[string]any{"quantity": 1}).expect(409, "version_conflict")
	// Roles: receiver, purchaser and team admin may; approver, plain member, system admin, outsider may not.
	for name, tok := range map[string]string{"approver": w.appr, "system admin": w.root, "outsider": w.outsider} {
		if r := rcpt(tok, a, ver(a), map[string]any{"quantity": 1}); r.Status != 403 {
			t.Errorf("%s: status %d, want 403: %s", name, r.Status, r.Body)
		}
	}
	// Validation.
	rcpt(w.mem, a, ver(a), map[string]any{"quantity": 0}).expect(400, "invalid_request")
	rcpt(w.mem, a, ver(a), map[string]any{"quantity": 1, "unknown": true}).expect(400, "invalid_request")
	rcpt(w.mem, a, ver(a), map[string]any{}).expect(400, "invalid_request")
	rcpt(w.mem, a, ver(a), map[string]any{"quantity": 3}).expect(422, "receipt_exceeds_quantity")
	rcpt(w.mem, "000000000000000000000000", `"1"`, map[string]any{"quantity": 1}).expect(404, "not_found")
	rcpt(w.mem, "nope", `"1"`, map[string]any{"quantity": 1}).expect(404, "not_found")
	rcpt(w.buyer, a, ver(a), map[string]any{"quantity": 1}).expect(201) // purchasers may receive
	rcpt(w.adm, a, ver(a), map[string]any{"quantity": 1}).expect(201)   // so may team admins; a is now complete
	rcpt(w.mem, a, ver(a), map[string]any{"quantity": 1}).expect(422, "receipt_exceeds_quantity")

	// Exceptions: validation and roles.
	exc := func(token, id string, ifMatch string, body map[string]any) *result {
		return w.do(t, call{token: token, method: "POST", path: w.path("/items/{}/exceptions", id), ifMatch: ifMatch, body: body, skipRequestValidation: true})
	}
	exc(w.mem, b, ver(b), map[string]any{"type": "damaged"}).expect(400, "invalid_request")
	exc(w.mem, b, ver(b), map[string]any{"type": "damaged", "description": "  "}).expect(400, "invalid_request")
	exc(w.mem, b, ver(b), map[string]any{"type": "melted", "description": "x"}).expect(400, "invalid_request")
	exc(w.mem, b, "", map[string]any{"type": "damaged", "description": "x"}).expect(428, "if_match_required")
	exc(w.appr, b, ver(b), map[string]any{"type": "damaged", "description": "x"}).expect(403, "forbidden")
	exc(w.root, b, ver(b), map[string]any{"type": "damaged", "description": "x"}).expect(403, "forbidden")
	exc(w.mem, a, ver(a), map[string]any{"type": "damaged", "description": "x"}).expect(409, "invalid_transition") // received is final
	x := exc(w.mem, b, ver(b), map[string]any{"type": "wrong_item", "description": "sent blue, ordered red"}).expect(201)
	exc(w.mem, b, ver(b), map[string]any{"type": "damaged", "description": "x"}).expect(409, "invalid_transition") // already in exception

	// Resolve: roles, validation, versions.
	resolve := func(token string, ifMatch string, body map[string]any) *result {
		return w.do(t, call{token: token, method: "POST", path: w.path("/exceptions/{}/resolve", x.String("exception", "id")), ifMatch: ifMatch, body: body, skipRequestValidation: true})
	}
	resolve(w.mem, `"1"`, map[string]any{"action": "exchange"}).expect(403, "forbidden") // receivers cannot resolve
	resolve(w.root, `"1"`, map[string]any{"action": "exchange"}).expect(403, "forbidden")
	resolve(w.buyer, "", map[string]any{"action": "exchange"}).expect(428, "if_match_required")
	resolve(w.buyer, `"7"`, map[string]any{"action": "exchange"}).expect(409, "version_conflict")
	resolve(w.buyer, `"1"`, map[string]any{"action": "return"}).expect(400, "invalid_request")
	resolve(w.buyer, `"1"`, map[string]any{}).expect(400, "invalid_request")
	resolve(w.buyer, `"1"`, map[string]any{"action": "cancel"}).expect(400, "invalid_request") // note required
	resolve(w.buyer, `"1"`, map[string]any{"action": "cancel", "note": "x", "refundAmountBase": "-5"}).expect(400, "invalid_request")
	resolve(w.buyer, `"1"`, map[string]any{"action": "cancel", "note": "x", "refundAmountBase": "0"}).expect(400, "invalid_request")
	resolve(w.buyer, `"1"`, map[string]any{"action": "cancel", "note": "x", "refundAmountBase": "5.5"}).expect(400, "invalid_request") // TWD has no decimals
	resolve(w.buyer, `"1"`, map[string]any{"action": "exchange", "refundAmountBase": "5"}).expect(400, "invalid_request")
	resolve(w.buyer, `"1"`, map[string]any{"action": "accept", "note": "x"}).expect(422, "nothing_received")
	resolve(w.outsider, `"1"`, map[string]any{"action": "exchange"}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: w.path("/exceptions/{}/resolve", "000000000000000000000000"), ifMatch: `"1"`, body: map[string]any{"action": "exchange"}}).expect(404, "not_found")
	ok := resolve(w.buyer, `"1"`, map[string]any{"action": "exchange", "note": "vendor will re-ship"}).expect(200)
	if ok.String("item", "status") != "ordered" || ok.JSON()["adjustment"] != nil || ok.String("batch", "status") != "receiving" {
		t.Fatalf("exchange = %s", ok.Body)
	}
	resolve(w.buyer, `"2"`, map[string]any{"action": "exchange"}).expect(422, "exception_resolved")

	// Adjustments.
	adj := func(token string, ifMatch string, body map[string]any) *result {
		return w.do(t, call{token: token, method: "POST", path: w.path("/orders/{}/adjustments", str(order, "id")), ifMatch: ifMatch, body: body, skipRequestValidation: true})
	}
	ov := func() string { return w.orderVer(t, batch, order) }
	adj(w.buyer, "", map[string]any{"amountBase": "-10", "reason": "x"}).expect(428, "if_match_required")
	adj(w.buyer, `"99"`, map[string]any{"amountBase": "-10", "reason": "x"}).expect(409, "version_conflict")
	adj(w.mem, ov(), map[string]any{"amountBase": "-10", "reason": "x"}).expect(403, "forbidden")
	adj(w.root, ov(), map[string]any{"amountBase": "-10", "reason": "x"}).expect(403, "forbidden")
	adj(w.buyer, ov(), map[string]any{"amountBase": "0", "reason": "x"}).expect(400, "invalid_request")
	adj(w.buyer, ov(), map[string]any{"amountBase": "-10", "reason": " "}).expect(400, "invalid_request")
	adj(w.buyer, ov(), map[string]any{"amountBase": "-1.5", "reason": "x"}).expect(400, "invalid_request")
	adj(w.buyer, ov(), map[string]any{"amountBase": "abc", "reason": "x"}).expect(400, "invalid_request")
	adj(w.buyer, ov(), map[string]any{"amountBase": "-10", "reason": "x", "itemId": "nope"}).expect(400, "invalid_request")
	adj(w.buyer, ov(), map[string]any{"amountBase": "-10", "reason": "x", "itemId": "000000000000000000000000"}).expect(400, "invalid_request")
	got := adj(w.buyer, ov(), map[string]any{"amountBase": "-100", "reason": "late delivery discount", "itemId": b}).expect(201)
	requireDecimal(t, "order adjustmentsBase", got.String("order", "adjustmentsBase"), "-100")
	requireDecimal(t, "order totalBase", got.String("order", "totalBase"), "1200") // 4 units x 325 - 100
	if got.Header.Get("ETag") == "" {
		t.Error("no ETag")
	}
	// The team's own batch may be hidden; an invisible order is 404 for strangers.
	cur := w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}", w.teamID)}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/teams/{}", w.teamID), ifMatch: cur.ETag(), body: map[string]any{"visibility": "members"}}).expect(200)
	adj(w.outsider, `"1"`, map[string]any{"amountBase": "-1", "reason": "x"}).expect(404, "not_found")
	rcpt(w.outsider, b, `"1"`, map[string]any{"quantity": 1}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "GET", path: w.path("/items/{}/receipts", a)}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "GET", path: w.path("/items/{}/exceptions", a)}).expect(404, "not_found")
	resolve(w.outsider, `"1"`, map[string]any{"action": "exchange"}).expect(404, "not_found")
}
