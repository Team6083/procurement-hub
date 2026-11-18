package app

import "testing"

// confirmedBatch opens a batch, adds one item per name (quantity 2), approves
// them all and confirms the review, so the items are ready to purchase.
func (w *world) confirmedBatch(t *testing.T, title string, names ...string) (batchID string, itemIDs []string) {
	t.Helper()
	id, _ := w.openBatch(t, title)
	bp := w.path("/batches/{}", id)
	for _, n := range names {
		itemIDs = append(itemIDs, w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody(n)}).expect(201).String("id"))
	}
	b := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "close"}}).expect(200)
	var ds []map[string]any
	for _, iid := range itemIDs {
		ds = append(ds, map[string]any{"itemId": iid, "decision": "approve"})
	}
	b = w.do(t, call{token: w.appr, method: "POST", path: bp + "/reviews", body: map[string]any{"decisions": ds}}).expect(200)
	b = w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "confirm_review"}}).expect(200)
	if b.String("status") != "purchasing" {
		t.Fatalf("status = %s", b.String("status"))
	}
	return id, itemIDs
}

func (w *world) item(t *testing.T, batchID, itemID string) map[string]any {
	t.Helper()
	for _, it := range w.do(t, call{token: w.adm, method: "GET", path: w.path("/batches/{}", batchID) + "/items"}).expect(200).Items() {
		if m := it.(map[string]any); m["id"] == itemID {
			return m
		}
	}
	t.Fatalf("item %s not found", itemID)
	return nil
}

// Purchasing happy path (spec acceptance 5): create from items, price, place,
// item and batch status follow; one blocker case on unplace.
func TestHTTPVendorOrderFlow(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	batchID, items := w.confirmedBatch(t, "Round 1", "motor", "wheel", "cable")
	bp := w.path("/batches/{}", batchID)

	// The queue lists all three items, purchasers only.
	w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/purchasing/queue"}).expect(403, "forbidden")
	q := w.do(t, call{token: buyer, method: "GET", path: "/api/v1/purchasing/queue"}).expect(200).Items()
	if len(q) != 1 || len(q[0].(map[string]any)["items"].([]any)) != 3 {
		t.Fatalf("queue = %v", q)
	}
	w.do(t, call{token: w.mem, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(403, "forbidden")

	// Create a draft from two items; amounts are incomplete until priced.
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{
		"vendorId": vendor.String("id"), "itemIds": []string{items[0], items[1]}}}).expect(201)
	op := w.path("/vendor-orders/{}", o.String("id"))
	lines := o.JSON()["lines"].([]any)
	if o.String("status") != "draft" || len(lines) != 2 || o.JSON()["totals"].(map[string]any)["netBase"] != nil {
		t.Fatalf("draft order: %s", o.Body)
	}
	if u := lines[0].(map[string]any)["productUrl"]; u != "https://shop.example.org/motor" {
		t.Errorf("line productUrl = %v", u)
	}
	if e, _ := lines[0].(map[string]any)["estimatedUnitPrice"].(map[string]any); e["amount"] != "10.5" && e["amount"] != "10.50" || e["currency"] != "USD" {
		t.Errorf("line estimatedUnitPrice = %v", e)
	}
	if got := w.item(t, batchID, items[0])["toPurchaseQuantity"]; got != float64(0) {
		t.Errorf("planned item still to purchase: %v", got)
	}
	w.do(t, call{token: buyer, method: "POST", path: op + "/place", ifMatch: o.ETag()}).expect(422, "line_missing_price")

	// Fill unit prices (each write returns the order and the next version).
	for i, price := range []string{"5.00", "7.50"} {
		l := lines[i].(map[string]any)
		o = w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendor-order-lines/{}", l["id"].(string)), ifMatch: o.ETag(), body: map[string]any{
			"teamId": l["teamId"], "name": l["name"], "quantity": l["quantity"], "unitPrice": price}}).expect(200)
	}
	w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendor-order-lines/{}", lines[0].(map[string]any)["id"].(string)), ifMatch: `"1"`, body: map[string]any{
		"teamId": lines[0].(map[string]any)["teamId"], "name": "x", "quantity": 2}}).expect(409, "version_conflict")
	o = w.do(t, call{token: buyer, method: "PUT", path: op, ifMatch: o.ETag(), body: map[string]any{
		"vendorId": vendor.String("id"), "currency": "USD", "ownerIds": []string{}, "paymentNote": "card"}}).expect(200)
	if net := o.JSON()["totals"].(map[string]any)["netBase"]; net != "25" || o.JSON()["invariantOk"] != true {
		t.Fatalf("netBase = %v: %s", net, o.Body)
	}

	// Place: items become ordered and the batch moves to receiving.
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/place", ifMatch: o.ETag()}).expect(200)
	if o.String("status") != "placed" {
		t.Fatalf("status = %s", o.String("status"))
	}
	if f := w.item(t, batchID, items[0]); f["fulfillment"] != "ordered" || f["orderedQuantity"] != float64(2) || f["costBase"] == nil {
		t.Errorf("item after place: %v", f)
	}
	if l := w.item(t, batchID, items[0])["lines"].([]any); len(l) != 1 || l[0].(map[string]any)["orderStatus"] != "placed" {
		t.Errorf("linked lines: %v", l)
	}
	// "wheel" and "motor" are ordered, "cable" is not: still purchasing.
	if st := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200).String("status"); st != "purchasing" {
		t.Errorf("batch = %s", st)
	}
	// Order only part of the third item, then mark the rest unpurchasable.
	o2 := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(201)
	o2 = w.do(t, call{token: buyer, method: "POST", path: w.path("/vendor-orders/{}", o2.String("id")) + "/lines", ifMatch: o2.ETag(), body: map[string]any{
		"itemId": items[2], "quantity": 1, "unitPrice": "3"}}).expect(201)
	if got := w.item(t, batchID, items[2]); got["toPurchaseQuantity"] != float64(1) {
		t.Errorf("remaining quantity: %v", got)
	}
	w.do(t, call{token: buyer, method: "POST", path: w.path("/vendor-orders/{}", o2.String("id")) + "/place", ifMatch: o2.ETag()}).expect(200)
	cable := w.item(t, batchID, items[2])
	w.do(t, call{token: buyer, method: "POST", path: w.path("/items/{}", items[2]) + "/unpurchasable", ifMatch: `"` + itoa(int(cable["version"].(float64))) + `"`,
		body: map[string]any{"reason": "no more stock"}}).expect(200)
	if st := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200).String("status"); st != "receiving" {
		t.Errorf("batch should be receiving: %s", st)
	}
	// Regular members read the order through their team's lines.
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: op}).expect(200).JSON()["lines"].([]any)); n != 2 {
		t.Errorf("member sees %d lines", n)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/vendor-orders"}).expect(200).Items()); n != 2 {
		t.Errorf("member lists %d orders", n)
	}

	o = w.do(t, call{token: buyer, method: "POST", path: op + "/unplace", ifMatch: o.ETag(), body: map[string]any{"reason": "oops"}}).expect(200)
	if o.String("status") != "draft" || w.item(t, batchID, items[0])["fulfillment"] != "not_ordered" {
		t.Errorf("after unplace: %s / %v", o.String("status"), w.item(t, batchID, items[0])["fulfillment"])
	}
	// Review confirmation cannot be undone while another order is still placed.
	cur := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: cur.ETag(), body: map[string]any{"action": "unconfirm_review", "reason": "oops"}}).expect(409, "blocked_by_dependency")

	// The timeline shows the order's history; /me/tasks counts the draft.
	if n := len(w.do(t, call{token: buyer, method: "GET", path: "/api/v1/audit?objectType=vendor_order&objectId=" + o.String("id")}).expect(200).Items()); n < 5 {
		t.Errorf("timeline events = %d", n)
	}
	tasks := w.do(t, call{token: buyer, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()
	if tasks["draftVendorOrders"].(map[string]any)["count"] != float64(1) {
		t.Errorf("tasks = %v", tasks)
	}
	w.do(t, call{token: buyer, method: "GET", path: "/api/v1/vendor-order-lines?toClose=true"}).expect(200)
	w.do(t, call{token: buyer, method: "POST", path: op + "/cancel", ifMatch: o.ETag(), body: map[string]any{"reason": "not needed"}}).expect(200)

	// Regular users see only their lines (acceptance 9): a standalone line of another team is hidden.
	beta := w.do(t, call{token: w.root, method: "POST", path: "/api/v1/teams", body: map[string]any{
		"slug": "beta", "name": "Beta", "description": "second", "firstAdminUserId": w.admID}}).expect(201)
	o3 := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(201)
	o3 = w.do(t, call{token: buyer, method: "POST", path: w.path("/vendor-orders/{}", o3.String("id")) + "/lines", ifMatch: o3.ETag(), body: map[string]any{
		"teamId": beta.String("id"), "name": "freight", "quantity": 1, "unitPrice": "9"}}).expect(201)
	p3 := w.path("/vendor-orders/{}", o3.String("id"))
	w.do(t, call{token: w.mem, method: "GET", path: p3}).expect(404, "not_found")
	w.do(t, call{token: buyer, method: "POST", path: p3 + "/lines", ifMatch: o3.ETag(), body: map[string]any{"itemId": items[0], "unitPrice": "1"}}).expect(201)
	seen := w.do(t, call{token: w.mem, method: "GET", path: p3}).expect(200).JSON()
	if len(seen["lines"].([]any)) != 1 || seen["restricted"] != true || seen["otherTeams"].(map[string]any)["lines"] != float64(1) || seen["totals"].(map[string]any)["netBase"] != nil {
		t.Errorf("restricted view: %v", seen)
	}
	// The visible line carries its item's requester; the merged other-team row carries nothing.
	if rq, _ := seen["lines"].([]any)[0].(map[string]any)["requester"].(map[string]any); rq == nil || rq["id"] == "" || rq["displayName"] == "" {
		t.Errorf("visible line requester: %v", seen["lines"])
	}
	if _, has := seen["otherTeams"].(map[string]any)["requester"]; has {
		t.Errorf("otherTeams leaks requester: %v", seen["otherTeams"])
	}
	if ow, _ := seen["owners"].([]any); len(ow) != 1 || ow[0].(map[string]any)["displayName"] == "" || ow[0].(map[string]any)["isPurchaser"] != true {
		t.Errorf("owners = %v", seen["owners"])
	}
	if _, has := seen["ownerIds"]; has {
		t.Errorf("ownerIds still in response")
	}
	// A purchaser sees every line; the standalone line has no requester.
	for _, l := range w.do(t, call{token: buyer, method: "GET", path: p3}).expect(200).JSON()["lines"].([]any) {
		if m := l.(map[string]any); m["itemId"] == nil && m["requester"] != nil {
			t.Errorf("standalone line requester: %v", m["requester"])
		}
	}
}

// Undoing the review confirmation removes the draft lines of the batch's items.
func TestHTTPUnconfirmRemovesDraftLines(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	batchID, items := w.confirmedBatch(t, "Round 1", "motor")
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{
		"vendorId": vendor.String("id"), "itemIds": []string{items[0]}}}).expect(201)
	bp := w.path("/batches/{}", batchID)
	cur := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: cur.ETag(), body: map[string]any{"action": "unconfirm_review", "reason": "wrong item"}}).expect(200)
	got := w.do(t, call{token: buyer, method: "GET", path: w.path("/vendor-orders/{}", o.String("id"))}).expect(200)
	if n := len(got.JSON()["lines"].([]any)); n != 0 {
		t.Errorf("draft lines left: %d", n)
	}
	if it := w.item(t, batchID, items[0]); it["fulfillment"] != nil || it["toPurchaseQuantity"] != float64(0) {
		t.Errorf("item computed fields: %v", it)
	}
}

// The order progress is computed and filterable: it follows deliveries,
// closure, reopening and a refund without a rate.
func TestHTTPVendorOrderProgress(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)
	ids := func(q string) int {
		return len(w.do(t, call{token: f.buyer, method: "GET", path: "/api/v1/vendor-orders?" + q}).expect(200).Items())
	}
	state := func() (string, string, any) {
		o := w.order(t, f)
		return o["receivingState"].(string), o["accountingState"].(string), o["completed"]
	}
	if r, a, c := state(); r != "none" || a != "final" || c != false || ids("completed=false") != 1 || ids("completed=true") != 0 {
		t.Fatalf("placed: %s %s %v", r, a, c)
	}
	d := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
		"lines": []map[string]any{{"name": "motor", "goodQuantity": 1}}}}).expect(201)
	dl := d.JSON()["lines"].([]any)[0].(map[string]any)
	w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", dl["id"].(string)), ifMatch: d.ETag(),
		body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 1, "problemQuantity": 0}}}}).expect(200)
	if r, _, _ := state(); r != "partial" {
		t.Fatalf("after delivery: %s", r)
	}
	lp := w.path("/vendor-order-lines/{}", f.lineID)
	o := w.do(t, call{token: f.buyer, method: "GET", path: f.orderPath}).expect(200)
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), body: map[string]any{"type": "short_accepted", "reason": "short"}}).expect(200)
	if r, a, c := state(); r != "closed" || a != "final" || c != true || ids("completed=true") != 1 || ids("completed=false") != 0 || ids("receivingState=closed") != 1 {
		t.Fatalf("closed: %s %s %v", r, a, c)
	}
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/reopen", ifMatch: o.ETag(), body: map[string]any{"reason": "more coming"}}).expect(200)
	if r, _, c := state(); r != "partial" || c != false {
		t.Fatalf("reopened: %s %v", r, c)
	}
	w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), body: map[string]any{
		"type": "short_accepted", "reason": "short", "refund": map[string]any{"currency": "TWD", "amount": "100", "method": "cash"}}}).expect(200)
	if r, a, c := state(); r != "closed" || a == "final" || c != false || ids("completed=false") != 1 {
		t.Fatalf("refund without rate: %s %s %v", r, a, c)
	}
}
