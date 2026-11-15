package app

import (
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

// orderWorld extends the single-team world with a second team (beta), a
// purchaser who works in both teams, and a purchaser of alpha only. The base
// currency is TWD without decimals, so USD purchases are converted.
type orderWorld struct {
	*world
	buyer, buyer2     string // tokens
	buyerID, buyer2ID string
	betaID            string
}

func setupOrders(t *testing.T) *orderWorld {
	t.Helper()
	w := setupWith(t, map[string]string{"BASE_CURRENCY": "TWD", "BASE_CURRENCY_DECIMALS": "0", "SUPPORTED_CURRENCIES": "TWD,USD,JPY"})
	ow := &orderWorld{world: w}
	ow.buyer = w.user(t, "buyer", false)
	ow.buyer2 = w.user(t, "buyer2", false)
	id := func(tok string) string {
		return w.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(200).String("id")
	}
	ow.buyerID, ow.buyer2ID = id(ow.buyer), id(ow.buyer2)
	beta := w.do(t, call{token: w.root, method: "POST", path: "/api/v1/teams", body: map[string]any{
		"slug": "beta", "name": "Beta", "firstAdminUserId": w.admID,
	}}).expect(201)
	ow.betaID = beta.String("id")
	add := func(team, uid string) {
		w.do(t, call{token: w.adm, method: "POST", path: "/api/v1/teams/" + team + "/members", body: map[string]any{"userId": uid, "role": "member"}}).expect(201)
	}
	add(w.teamID, ow.buyerID)
	add(w.teamID, ow.buyer2ID)
	for _, uid := range []string{w.apprID, w.memID, ow.buyerID} {
		add(ow.betaID, uid)
	}
	return ow
}

// orderingBatch takes a batch of the team through collecting and review so
// that every item is approved and the batch is in `ordering`. Items are
// "name:quantity" and cost 10.00 USD estimated. Returns the batch id and the
// item ids in order.
func (w *orderWorld) orderingBatch(t *testing.T, team string, purchasers []string, items ...string) (string, []string) {
	t.Helper()
	b := w.do(t, call{token: w.adm, method: "POST", path: w.path("/teams/{}/batches", team), body: map[string]any{"title": "Batch " + team}}).expect(201)
	id := b.String("id")
	p := w.path("/batches/{}", id)
	b = w.do(t, call{token: w.adm, method: "PATCH", path: p, ifMatch: b.ETag(), body: map[string]any{"deadline": deadline(48)}}).expect(200)
	b = w.do(t, call{token: w.adm, method: "PUT", path: p + "/assignments", ifMatch: b.ETag(), body: map[string]any{
		"approvers": []string{w.apprID}, "purchasers": purchasers, "receivers": []string{w.memID}}}).expect(200)
	b = w.do(t, call{token: w.adm, method: "POST", path: p + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "open"}}).expect(200)
	var ids []string
	var decisions []map[string]any
	for _, spec := range items {
		name, qty, _ := strings.Cut(spec, ":")
		body := itemBody(name)
		body["quantity"] = atoi(qty)
		it := w.do(t, call{token: w.mem, method: "POST", path: p + "/items", body: body}).expect(201)
		ids = append(ids, it.String("id"))
		decisions = append(decisions, map[string]any{"itemId": it.String("id"), "decision": "approve"})
	}
	b = w.do(t, call{token: w.adm, method: "POST", path: p + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "close"}}).expect(200)
	res := w.do(t, call{token: w.appr, method: "POST", path: p + "/reviews", body: map[string]any{"decisions": decisions}}).expect(200)
	if res.String("batch", "status") != "ordering" {
		t.Fatalf("batch status = %s", res.String("batch", "status"))
	}
	return id, ids
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

func (w *orderWorld) createOrder(t *testing.T, token, batch, vendor string, items ...string) *result {
	t.Helper()
	return w.do(t, call{token: token, method: "POST", path: w.path("/batches/{}/orders", batch), body: map[string]any{"vendor": vendor, "itemIds": items}})
}

func dec(t *testing.T, s string) decimal.Decimal {
	t.Helper()
	d, err := decimal.NewFromString(s)
	if err != nil {
		t.Fatalf("not a decimal: %q", s)
	}
	return d
}

func requireDecimal(t *testing.T, what, got, want string) {
	t.Helper()
	if !dec(t, got).Equal(dec(t, want)) {
		t.Errorf("%s = %s, want %s", what, got, want)
	}
}

func (w *orderWorld) batchStatus(t *testing.T, id string) string {
	t.Helper()
	return w.do(t, call{token: w.adm, method: "GET", path: w.path("/batches/{}", id)}).expect(200).String("status")
}

func (w *orderWorld) orderOf(t *testing.T, token, batch, orderID string) map[string]any {
	t.Helper()
	for _, o := range w.do(t, call{token: token, method: "GET", path: w.path("/batches/{}/orders", batch)}).expect(200).Items() {
		if m := o.(map[string]any); m["id"] == orderID {
			return m
		}
	}
	t.Fatalf("order %s not found", orderID)
	return nil
}

func (w *orderWorld) itemOf(t *testing.T, batch, itemID string) map[string]any {
	t.Helper()
	for _, it := range w.do(t, call{token: w.adm, method: "GET", path: w.path("/batches/{}/items", batch)}).expect(200).Items() {
		if m := it.(map[string]any); m["id"] == itemID {
			return m
		}
	}
	t.Fatalf("item %s not found", itemID)
	return nil
}

func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }

// Team orders: creation rules, editing, cancelling and who may do what.
func TestHTTPTeamOrders(t *testing.T) {
	w := setupOrders(t)
	batch, items := w.orderingBatch(t, w.teamID, []string{w.buyerID}, "a:1", "b:2", "c:3")
	bp := w.path("/batches/{}/orders", batch)

	// Purchasers (and team admins) create orders; nobody else, system admins included.
	body := map[string]any{"vendor": "Acme", "itemIds": []string{items[0]}}
	w.do(t, call{token: w.mem, method: "POST", path: bp, body: body}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "POST", path: bp, body: body}).expect(403, "forbidden")
	w.do(t, call{token: w.outsider, method: "POST", path: bp, body: body}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: bp, body: map[string]any{"vendor": " ", "itemIds": []string{items[0]}}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "POST", path: bp, body: map[string]any{"vendor": "Acme", "itemIds": []string{items[0], items[0]}}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "POST", path: bp, body: map[string]any{"vendor": "Acme", "itemIds": []string{"000000000000000000000000"}}}).expect(400, "invalid_request")

	o1 := w.createOrder(t, w.buyer, batch, "Acme", items[0], items[1]).expect(201)
	if o1.String("status") != "draft" || o1.JSON()["number"].(float64) != 1 || o1.JSON()["costsProvisional"] != true {
		t.Fatalf("order = %s", o1.Body)
	}
	requireDecimal(t, "totalBase", o1.String("totalBase"), "0")
	if it := w.itemOf(t, batch, items[0]); it["orderId"] != o1.String("id") {
		t.Errorf("item orderId = %v", it["orderId"])
	}
	// An item sits in at most one live order.
	w.createOrder(t, w.buyer, batch, "Other", items[1]).expect(422, "item_not_orderable")
	// Team admins are implicit purchasers.
	o2 := w.createOrder(t, w.adm, batch, "Beta Supply", items[2]).expect(201)
	if o2.JSON()["number"].(float64) != 2 {
		t.Errorf("number = %v", o2.JSON()["number"])
	}

	// Everyone who can read the batch sees the orders.
	if n := len(w.do(t, call{token: w.outsider, method: "GET", path: bp}).expect(200).Items()); n != 2 {
		t.Errorf("orders = %d", n)
	}

	// PATCH: partial, needs If-Match, replaces the item set.
	op := w.path("/orders/{}", o1.String("id"))
	w.do(t, call{token: w.buyer, method: "PATCH", path: op, body: map[string]any{"vendor": "Acme 2"}, skipRequestValidation: true}).expect(428, "if_match_required")
	u := w.do(t, call{token: w.buyer, method: "PATCH", path: op, ifMatch: o1.ETag(), body: map[string]any{"vendor": "Acme 2"}}).expect(200)
	if u.String("vendor") != "Acme 2" || len(u.JSON()["itemIds"].([]any)) != 2 {
		t.Fatalf("patched = %s", u.Body)
	}
	w.do(t, call{token: w.buyer, method: "PATCH", path: op, ifMatch: o1.ETag(), body: map[string]any{"vendor": "x"}}).expect(409, "version_conflict")
	w.do(t, call{token: w.mem, method: "PATCH", path: op, ifMatch: u.ETag(), body: map[string]any{"vendor": "x"}}).expect(403, "forbidden")
	// Move item b to the other order: not possible while it is taken, possible after releasing.
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/orders/{}", o2.String("id")), ifMatch: o2.ETag(), body: map[string]any{"itemIds": []string{items[2], items[1]}}}).expect(422, "item_not_orderable")
	u = w.do(t, call{token: w.buyer, method: "PATCH", path: op, ifMatch: u.ETag(), body: map[string]any{"itemIds": []string{items[0]}}}).expect(200)
	if it := w.itemOf(t, batch, items[1]); it["orderId"] != nil {
		t.Errorf("released item still has orderId %v", it["orderId"])
	}
	o2b := w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/orders/{}", o2.String("id")), ifMatch: o2.ETag(), body: map[string]any{"itemIds": []string{items[2], items[1]}}}).expect(200)
	if len(o2b.JSON()["itemIds"].([]any)) != 2 {
		t.Fatalf("order = %s", o2b.Body)
	}

	// DELETE cancels (kept, status cancelled) and releases the items.
	c := w.do(t, call{token: w.adm, method: "DELETE", path: w.path("/orders/{}", o2.String("id")), ifMatch: o2b.ETag()}).expect(200)
	if c.String("status") != "cancelled" {
		t.Fatalf("status = %s", c.String("status"))
	}
	if it := w.itemOf(t, batch, items[2]); it["orderId"] != nil || it["status"] != "approved" {
		t.Errorf("item after cancel: %v", it)
	}
	w.do(t, call{token: w.adm, method: "DELETE", path: w.path("/orders/{}", o2.String("id")), ifMatch: c.ETag()}).expect(422, "order_not_draft")
	w.createOrder(t, w.buyer, batch, "Acme", items[2], items[1]).expect(201)

	// Invisible batches are 404: a members-only team hides orders from strangers.
	cur := w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}", w.teamID)}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/teams/{}", w.teamID), ifMatch: cur.ETag(), body: map[string]any{"visibility": "members"}}).expect(200)
	w.do(t, call{token: w.outsider, method: "GET", path: bp}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "PATCH", path: op, ifMatch: u.ETag(), body: map[string]any{"vendor": "x"}}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "POST", path: bp, body: body}).expect(404, "not_found")
}

// Marking items unpurchasable, and the batch's automatic transitions.
func TestHTTPUnpurchasableAndAutoTransitions(t *testing.T) {
	w := setupOrders(t)
	batch, items := w.orderingBatch(t, w.teamID, []string{w.buyerID}, "a:1", "b:1")
	reason := map[string]any{"reason": "discontinued"}
	ip := func(i int) string { return w.path("/items/{}/unpurchasable", items[i]) }
	ver := func(i int) string { return `"` + itoa(int(w.itemOf(t, batch, items[i])["version"].(float64))) + `"` }

	w.do(t, call{token: w.mem, method: "POST", path: ip(0), ifMatch: ver(0), body: reason}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "POST", path: ip(0), ifMatch: ver(0), body: reason}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: ip(0), ifMatch: ver(0), body: map[string]any{"reason": " "}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "POST", path: ip(0), body: reason, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.buyer, method: "POST", path: ip(0), ifMatch: `"99"`, body: reason}).expect(409, "version_conflict")

	// An item that sits in an order must leave it first.
	o := w.createOrder(t, w.buyer, batch, "Acme", items[1]).expect(201)
	w.do(t, call{token: w.buyer, method: "POST", path: ip(1), ifMatch: ver(1), body: reason}).expect(422, "item_in_order")

	got := w.do(t, call{token: w.buyer, method: "POST", path: ip(0), ifMatch: ver(0), body: reason}).expect(200)
	if got.String("status") != "unpurchasable" || got.String("closeReason") != "discontinued" {
		t.Fatalf("item = %s", got.Body)
	}
	w.do(t, call{token: w.buyer, method: "POST", path: ip(0), ifMatch: got.ETag(), body: reason}).expect(409, "invalid_transition")
	if s := w.batchStatus(t, batch); s != "ordering" {
		t.Fatalf("batch = %s, an approved item is still open", s)
	}

	// Cancel the order and mark the last item: every approved item is
	// unpurchasable, so the batch completes without ever receiving.
	w.do(t, call{token: w.buyer, method: "DELETE", path: w.path("/orders/{}", o.String("id")), ifMatch: o.ETag()}).expect(200)
	w.do(t, call{token: w.buyer, method: "POST", path: ip(1), ifMatch: ver(1), body: reason}).expect(200)
	if s := w.batchStatus(t, batch); s != "completed" {
		t.Fatalf("batch = %s, want completed", s)
	}
	// And nothing can be ordered or changed any more.
	w.createOrder(t, w.buyer, batch, "Acme", items[0]).expect(422, "batch_not_ordering")
}

// Acceptance criterion 5 and the whole external-order life cycle: one buyer
// merges the orders of two teams into one USD external order with shipping;
// after entering prices and the charged amount in TWD the teams' costs add up
// to the charge exactly.
func TestHTTPVendorTransactionAcrossTeams(t *testing.T) {
	w := setupOrders(t)
	alpha, aItems := w.orderingBatch(t, w.teamID, []string{w.buyerID, w.buyer2ID}, "a1:1", "a2:2")
	beta, bItems := w.orderingBatch(t, w.betaID, []string{w.buyerID}, "b1:3")

	// batchesToOrder lists both batches for the buyer with the number of waiting items.
	tasks := w.do(t, call{token: w.buyer, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["batchesToOrder"].([]any)
	counts := map[string]float64{}
	for _, tk := range tasks {
		m := tk.(map[string]any)
		counts[m["batch"].(map[string]any)["id"].(string)] = m["count"].(float64)
	}
	if counts[alpha] != 2 || counts[beta] != 1 || len(counts) != 2 {
		t.Errorf("batchesToOrder = %v", counts)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["batchesToOrder"].([]any)); n != 0 {
		t.Errorf("a plain member has %d ordering tasks", n)
	}
	if n := len(w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["batchesToOrder"].([]any)); n != 2 {
		t.Errorf("team admin has %d ordering tasks, want 2 (implicit purchaser)", n)
	}

	oa := w.createOrder(t, w.buyer, alpha, "Acme", aItems[0]).expect(201)
	oa2 := w.createOrder(t, w.buyer, alpha, "Acme", aItems[1]).expect(201)
	ob := w.createOrder(t, w.buyer, beta, "Acme", bItems[0]).expect(201)
	txBody := func(orders ...*result) map[string]any {
		ids := []string{}
		for _, o := range orders {
			ids = append(ids, o.String("id"))
		}
		return map[string]any{"orderIds": ids, "currency": "USD"}
	}

	// Creation: the buyer must be purchaser of every batch; system admins are not.
	w.do(t, call{token: w.buyer2, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa, ob)}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa, ob)}).expect(403, "forbidden")
	w.do(t, call{token: w.mem, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa, ob)}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: map[string]any{"orderIds": []string{oa.String("id")}, "currency": "EUR"}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: map[string]any{"orderIds": []string{"000000000000000000000000"}, "currency": "USD"}}).expect(404, "not_found")
	w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: map[string]any{"orderIds": []string{oa.String("id"), oa.String("id")}, "currency": "USD"}}).expect(400, "invalid_request")

	tx := w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa, ob)}).expect(201)
	if tx.String("status") != "draft" || tx.String("vendor") != "Acme" || len(tx.JSON()["teamIds"].([]any)) != 2 || len(tx.JSON()["batchIds"].([]any)) != 2 {
		t.Fatalf("transaction = %s", tx.Body)
	}
	txID := tx.String("id")
	tp := w.path("/vendor-transactions/{}", txID)
	// An order belongs to one external order; locked orders cannot be edited.
	w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa)}).expect(422, "order_not_available")
	w.do(t, call{token: w.buyer, method: "PATCH", path: w.path("/orders/{}", oa.String("id")),
		ifMatch: `"` + itoa(int(w.orderOf(t, w.buyer, alpha, oa.String("id"))["version"].(float64))) + `"`, body: map[string]any{"vendor": "x"}}).expect(422, "order_in_transaction")

	// Prices and shared costs. USD 10.00 x 1 (alpha) and 10.00 x 3 (beta); shipping USD 4.
	patch := func(token string, ifMatch string, body map[string]any) *result {
		return w.do(t, call{token: token, method: "PATCH", path: tp, ifMatch: ifMatch, body: body, skipRequestValidation: ifMatch == ""})
	}
	usd := func(a string) map[string]any { return map[string]any{"amount": a, "currency": "USD"} }
	prices := []map[string]any{
		{"itemId": aItems[0], "actualUnitPrice": usd("10.00")},
		{"itemId": bItems[0], "actualUnitPrice": usd("10")},
	}
	// Validation.
	patch(w.buyer, tx.ETag(), map[string]any{"itemPrices": []map[string]any{{"itemId": aItems[0], "actualUnitPrice": map[string]any{"amount": "10", "currency": "TWD"}}}}).expect(400, "invalid_request")
	patch(w.buyer, tx.ETag(), map[string]any{"itemPrices": []map[string]any{{"itemId": aItems[0], "actualUnitPrice": usd("1.234")}}}).expect(400, "invalid_request")
	patch(w.buyer, tx.ETag(), map[string]any{"itemPrices": []map[string]any{{"itemId": aItems[1], "actualUnitPrice": usd("1")}}}).expect(400, "invalid_request") // not in this external order
	patch(w.buyer, tx.ETag(), map[string]any{"sharedCosts": []map[string]any{{"type": "shipping", "amount": "1.001"}}}).expect(400, "invalid_request")
	patch(w.buyer, tx.ETag(), map[string]any{"sharedCosts": []map[string]any{{"type": "discount", "amount": "1"}}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: tx.ETag(), skipRequestValidation: true,
		body: map[string]any{"sharedCosts": []map[string]any{{"type": "gift", "amount": "1"}}}}).expect(400, "invalid_request")
	w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: tx.ETag(), skipRequestValidation: true,
		body: map[string]any{"unknownField": 1}}).expect(400, "invalid_request")
	patch(w.buyer, tx.ETag(), map[string]any{"chargedAmountBase": "1400.5"}).expect(400, "invalid_request") // TWD has no decimals
	patch(w.buyer, tx.ETag(), map[string]any{"chargedAmountBase": "-1"}).expect(400, "invalid_request")
	patch(w.buyer, "", map[string]any{"vendor": "x"}).expect(428, "if_match_required")
	patch(w.buyer, `"x"`, map[string]any{"vendor": "x"}).expect(400, "invalid_if_match")
	patch(w.mem, tx.ETag(), map[string]any{"vendor": "x"}).expect(403, "forbidden")
	patch(w.buyer2, tx.ETag(), map[string]any{"vendor": "x"}).expect(403, "forbidden")
	patch(w.root, tx.ETag(), map[string]any{"vendor": "x"}).expect(403, "forbidden")

	// Without prices nothing can be converted yet: provisional, zero.
	p1 := patch(w.buyer, tx.ETag(), map[string]any{
		"sharedCosts":     []map[string]any{{"type": "shipping", "amount": "4.00", "note": "DHL"}},
		"externalOrderNo": "PO-1", "paymentNote": "card 1", "expectedDeliveryDate": "2026-12-01T00:00:00Z",
	}).expect(200)
	if p1.String("externalOrderNo") != "PO-1" || p1.JSON()["hiddenOrderCount"].(float64) != 0 {
		t.Fatalf("patched = %s", p1.Body)
	}
	if o := w.orderOf(t, w.buyer, alpha, oa.String("id")); o["costsProvisional"] != true {
		t.Errorf("order = %v", o)
	}
	w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: tx.ETag(), body: map[string]any{"vendor": "x"}}).expect(409, "version_conflict")

	p2 := patch(w.buyer, p1.ETag(), map[string]any{"itemPrices": prices, "chargedAmountBase": "1400"}).expect(200)
	if p2.JSON()["chargedAmountBase"] == nil {
		t.Fatalf("charged missing: %s", p2.Body)
	}
	// Shares are proportional to the item subtotals (10 : 30).
	shares := map[string]string{}
	for _, a := range p2.JSON()["allocations"].([]any) {
		m := a.(map[string]any)
		shares[m["orderId"].(string)] = m["shareOfSharedCosts"].(string)
		if m["overridden"] != false {
			t.Errorf("allocation overridden: %v", m)
		}
	}
	requireDecimal(t, "alpha share", shares[oa.String("id")], "1")
	requireDecimal(t, "beta share", shares[ob.String("id")], "3")
	a, b := w.orderOf(t, w.buyer, alpha, oa.String("id")), w.orderOf(t, w.buyer, beta, ob.String("id"))
	requireDecimal(t, "alpha items", str(a, "itemsCostBase"), "318")
	requireDecimal(t, "alpha shared", str(a, "sharedCostBase"), "32")
	requireDecimal(t, "alpha total", str(a, "totalBase"), "350")
	requireDecimal(t, "beta items", str(b, "itemsCostBase"), "955")
	requireDecimal(t, "beta shared", str(b, "sharedCostBase"), "95")
	requireDecimal(t, "beta total", str(b, "totalBase"), "1050")
	if a["costsProvisional"] != false || b["costsProvisional"] != false {
		t.Errorf("costs from a charged amount are final: %v %v", a["costsProvisional"], b["costsProvisional"])
	}
	// Acceptance 5: what the two teams' reports will sum to is exactly the charge.
	sum := dec(t, str(a, "totalBase")).Add(dec(t, str(b, "totalBase")))
	requireDecimal(t, "sum of the teams' costs", sum.String(), "1400")
	ai, bi := w.itemOf(t, alpha, aItems[0]), w.itemOf(t, beta, bItems[0])
	requireDecimal(t, "item a1 actualCostBase", str(ai, "actualCostBase"), "318")
	requireDecimal(t, "item b1 actualCostBase", str(bi, "actualCostBase"), "955")
	if ai["actualUnitPrice"].(map[string]any)["currency"] != "USD" {
		t.Errorf("actualUnitPrice = %v", ai["actualUnitPrice"])
	}

	// Overriding the allocation needs a reason and the right sum.
	ov := func(x, y string) []map[string]any {
		return []map[string]any{{"orderId": oa.String("id"), "shareOfSharedCosts": x}, {"orderId": ob.String("id"), "shareOfSharedCosts": y}}
	}
	patch(w.buyer, p2.ETag(), map[string]any{"allocations": ov("2.5", "1.5")}).expect(422, "allocation_override_reason_required")
	patch(w.buyer, p2.ETag(), map[string]any{"allocations": ov("2", "1"), "allocationOverrideReason": "agreed"}).expect(422, "allocation_sum_mismatch")
	patch(w.buyer, p2.ETag(), map[string]any{"allocations": ov("2.501", "1.499"), "allocationOverrideReason": "agreed"}).expect(400, "invalid_request")
	patch(w.buyer, p2.ETag(), map[string]any{"allocations": ov("4", "0")[:1], "allocationOverrideReason": "agreed"}).expect(400, "invalid_request")
	p3 := patch(w.buyer, p2.ETag(), map[string]any{"allocations": ov("2.5", "1.5"), "allocationOverrideReason": "agreed"}).expect(200)
	for _, al := range p3.JSON()["allocations"].([]any) {
		if al.(map[string]any)["overridden"] != true {
			t.Errorf("allocation not overridden: %v", al)
		}
	}
	a, b = w.orderOf(t, w.buyer, alpha, oa.String("id")), w.orderOf(t, w.buyer, beta, ob.String("id"))
	requireDecimal(t, "alpha total (override)", str(a, "totalBase"), "398")
	requireDecimal(t, "beta total (override)", str(b, "totalBase"), "1002")
	// Changing the shared costs under a manual override must not silently break the sum.
	patch(w.buyer, p3.ETag(), map[string]any{"sharedCosts": []map[string]any{{"type": "shipping", "amount": "5.00"}}}).expect(422, "allocation_sum_mismatch")
	// Back to proportional (the reason is dropped).
	p4 := patch(w.buyer, p3.ETag(), map[string]any{"allocations": nil}).expect(200)
	if p4.String("allocationOverrideReason") != "" {
		t.Errorf("reason kept: %q", p4.String("allocationOverrideReason"))
	}
	if a := w.orderOf(t, w.buyer, alpha, oa.String("id")); str(a, "totalBase") != "350" {
		t.Errorf("alpha total = %v", a["totalBase"])
	}
	// A no-op patch changes nothing (version stays).
	p5 := patch(w.buyer, p4.ETag(), map[string]any{"paymentNote": "card 1"}).expect(200)
	if p5.ETag() != p4.ETag() {
		t.Errorf("no-op patch changed the version: %s -> %s", p4.ETag(), p5.ETag())
	}

	// Visibility: beta hides its batch from strangers; an outsider sees alpha's
	// order and only the total of the one it cannot read.
	cur := w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}", w.betaID)}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/teams/{}", w.betaID), ifMatch: cur.ETag(), body: map[string]any{"visibility": "members"}}).expect(200)
	view := w.do(t, call{token: w.outsider, method: "GET", path: tp}).expect(200).JSON()
	if len(view["orders"].([]any)) != 1 || view["hiddenOrderCount"].(float64) != 1 || len(view["orderIds"].([]any)) != 1 || len(view["allocations"].([]any)) != 1 {
		t.Errorf("outsider view = %v", view)
	}
	requireDecimal(t, "hidden total", view["hiddenOrdersTotalBase"].(string), "1050")
	if strings.Contains(string(w.do(t, call{token: w.outsider, method: "GET", path: tp}).Body), ob.String("id")) {
		t.Error("the unreadable order id leaked")
	}
	patch(w.outsider, p5.ETag(), map[string]any{"vendor": "x"}).expect(403, "forbidden")
	full := w.do(t, call{token: w.buyer, method: "GET", path: tp}).expect(200).JSON()
	if len(full["orders"].([]any)) != 2 || full["hiddenOrderCount"].(float64) != 0 {
		t.Errorf("buyer view = %v", full)
	}
	cur = w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}", w.teamID)}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/teams/{}", w.teamID), ifMatch: cur.ETag(), body: map[string]any{"visibility": "members"}}).expect(200)
	w.do(t, call{token: w.outsider, method: "GET", path: tp}).expect(404, "not_found")
	patch(w.outsider, p5.ETag(), map[string]any{"vendor": "x"}).expect(404, "not_found")

	// Place: version guard, permission, atomic effects, automatic batch transitions.
	pl := tp + "/place"
	w.do(t, call{token: w.buyer2, method: "POST", path: pl, ifMatch: p5.ETag()}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: pl, ifMatch: p1.ETag()}).expect(409, "version_conflict")
	// Beta's only item gets ordered by this; alpha still has a2 approved.
	placed := w.do(t, call{token: w.buyer, method: "POST", path: pl, ifMatch: p5.ETag()}).expect(200)
	if placed.String("status") != "placed" || placed.String("placedAt") == "" || placed.String("placedBy") != w.buyerID {
		t.Fatalf("placed = %s", placed.Body)
	}
	if o := w.orderOf(t, w.buyer, alpha, oa.String("id")); o["status"] != "placed" {
		t.Errorf("order = %v", o)
	}
	if it := w.itemOf(t, alpha, aItems[0]); it["status"] != "ordered" {
		t.Errorf("item = %v", it)
	}
	if s := w.batchStatus(t, beta); s != "receiving" {
		t.Errorf("beta = %s, want receiving (all approved items ordered)", s)
	}
	if s := w.batchStatus(t, alpha); s != "ordering" {
		t.Errorf("alpha = %s, a2 is still waiting", s)
	}
	w.do(t, call{token: w.buyer, method: "POST", path: pl, ifMatch: placed.ETag()}).expect(422, "vendor_transaction_not_draft")
	w.do(t, call{token: w.buyer, method: "POST", path: tp + "/cancel", ifMatch: placed.ETag()}).expect(422, "vendor_transaction_not_draft")
	w.do(t, call{token: w.buyer, method: "PATCH", path: w.path("/orders/{}", oa.String("id")), ifMatch: `"1"`, body: map[string]any{"vendor": "x"}}).expect(422, "order_not_draft")

	// Bills arrive late: a placed external order stays editable, costs follow.
	patch(w.buyer, placed.ETag(), map[string]any{"chargedAmountBase": "1500", "paymentNote": "invoice 77"}).expect(200)
	a, b = w.orderOf(t, w.buyer, alpha, oa.String("id")), w.orderOf(t, w.buyer, beta, ob.String("id"))
	sum = dec(t, str(a, "totalBase")).Add(dec(t, str(b, "totalBase")))
	requireDecimal(t, "sum after the late bill", sum.String(), "1500")
	// Finish alpha: order a2, put it in its own external order, place it.
	tx2 := w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: txBody(oa2)}).expect(201)
	if s := w.batchStatus(t, alpha); s != "ordering" {
		t.Fatalf("alpha = %s", s)
	}
	w.do(t, call{token: w.buyer, method: "POST", path: w.path("/vendor-transactions/{}/place", tx2.String("id")), ifMatch: tx2.ETag()}).expect(200)
	if s := w.batchStatus(t, alpha); s != "receiving" {
		t.Errorf("alpha = %s, want receiving", s)
	}

	// The batch timelines show the external order's life.
	actions := map[string]bool{}
	for _, e := range w.do(t, call{token: w.buyer, method: "GET", path: "/api/v1/audit?objectType=batch&objectId=" + beta}).expect(200).Items() {
		actions[e.(map[string]any)["action"].(string)] = true
	}
	for _, want := range []string{"order.created", "vendor_transaction.created", "vendor_transaction.updated", "vendor_transaction.placed", "order.placed", "item.ordered", "batch.auto_transition"} {
		if !actions[want] {
			t.Errorf("beta timeline lacks %s: %v", want, actions)
		}
	}
}

// Cancelling a draft external order releases its orders.
func TestHTTPCancelVendorTransaction(t *testing.T) {
	w := setupOrders(t)
	batch, items := w.orderingBatch(t, w.teamID, []string{w.buyerID}, "a:2")
	o := w.createOrder(t, w.buyer, batch, "Acme", items[0]).expect(201)
	tx := w.do(t, call{token: w.buyer, method: "POST", path: "/api/v1/vendor-transactions", body: map[string]any{
		"orderIds": []string{o.String("id")}, "currency": "TWD", "vendor": "Acme Direct", "externalOrderNo": "X1"}}).expect(201)
	tp := w.path("/vendor-transactions/{}", tx.String("id"))
	// The base currency needs no charged amount: exact, not provisional.
	p := w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: tx.ETag(), body: map[string]any{
		"itemPrices":  []map[string]any{{"itemId": items[0], "actualUnitPrice": map[string]any{"amount": "150", "currency": "TWD"}}},
		"sharedCosts": []map[string]any{{"type": "shipping", "amount": "60"}, {"type": "discount", "amount": "-10"}},
	}}).expect(200)
	ord := w.orderOf(t, w.buyer, batch, o.String("id"))
	requireDecimal(t, "items", str(ord, "itemsCostBase"), "300")
	requireDecimal(t, "shared", str(ord, "sharedCostBase"), "50")
	requireDecimal(t, "total", str(ord, "totalBase"), "350")
	if ord["costsProvisional"] != false {
		t.Errorf("base-currency costs are exact: %v", ord["costsProvisional"])
	}
	// Clearing a price makes the costs provisional/unknown again.
	p = w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: p.ETag(), body: map[string]any{
		"itemPrices": []map[string]any{{"itemId": items[0], "actualUnitPrice": nil}}}}).expect(200)
	if it := w.itemOf(t, batch, items[0]); it["actualUnitPrice"] != nil || it["actualCostBase"] != nil {
		t.Errorf("item = %v", it)
	}
	p = w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: p.ETag(), body: map[string]any{
		"itemPrices": []map[string]any{{"itemId": items[0], "actualUnitPrice": map[string]any{"amount": "150", "currency": "TWD"}}}}}).expect(200)

	w.do(t, call{token: w.buyer2, method: "POST", path: tp + "/cancel", ifMatch: p.ETag()}).expect(403, "forbidden")
	w.do(t, call{token: w.buyer, method: "POST", path: tp + "/cancel", ifMatch: tx.ETag()}).expect(409, "version_conflict")
	c := w.do(t, call{token: w.buyer, method: "POST", path: tp + "/cancel", ifMatch: p.ETag()}).expect(200)
	if c.String("status") != "cancelled" {
		t.Fatalf("status = %s", c.String("status"))
	}
	ord = w.orderOf(t, w.buyer, batch, o.String("id"))
	if ord["vendorTransactionId"] != nil || ord["status"] != "draft" || ord["costsProvisional"] != true {
		t.Errorf("released order = %v", ord)
	}
	requireDecimal(t, "released total", str(ord, "totalBase"), "0")
	if it := w.itemOf(t, batch, items[0]); it["actualUnitPrice"] != nil || it["actualCostBase"] != nil {
		t.Errorf("item prices not cleared: %v", it)
	}
	w.do(t, call{token: w.buyer, method: "PATCH", path: tp, ifMatch: c.ETag(), body: map[string]any{"vendor": "x"}}).expect(422, "vendor_transaction_cancelled")
	w.do(t, call{token: w.buyer, method: "POST", path: tp + "/place", ifMatch: c.ETag()}).expect(422, "vendor_transaction_not_draft")
	// The order is free again: edit it and put it in a new external order.
	w.do(t, call{token: w.buyer, method: "PATCH", path: w.path("/orders/{}", o.String("id")), ifMatch: `"` + itoa(int(ord["version"].(float64))) + `"`, body: map[string]any{"vendor": "Acme 3"}}).expect(200)
	w.do(t, call{token: w.buyer, method: "GET", path: w.path("/vendor-transactions/{}", "000000000000000000000000")}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "GET", path: tp}).expect(200)
}
