package app

import "testing"

// confirmedBatchWith is confirmedBatch for item bodies given by the caller.
func (w *world) confirmedBatchWith(t *testing.T, title string, bodies ...map[string]any) []string {
	t.Helper()
	id, _ := w.openBatch(t, title)
	bp := w.path("/batches/{}", id)
	var ids []string
	for _, body := range bodies {
		ids = append(ids, w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: body}).expect(201).String("id"))
	}
	b := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "close"}}).expect(200)
	var ds []map[string]any
	for _, iid := range ids {
		ds = append(ds, map[string]any{"itemId": iid, "decision": "approve"})
	}
	b = w.do(t, call{token: w.appr, method: "POST", path: bp + "/reviews", body: map[string]any{"decisions": ds}}).expect(200)
	w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "confirm_review"}}).expect(200)
	return ids
}

func withVendor(name string, extra map[string]any) map[string]any {
	b := itemBody(name)
	for k, v := range extra {
		b[k] = v
	}
	return b
}

// One grouping rule: an item belongs to a vendor only through vendorId, a
// typed name is matched to a vendor only when the item is written, and an
// inactive vendor still forms its own group. The queue and /me/tasks agree.
func TestHTTPVendorGrouping(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	mk := func(name string, aliases ...string) *result {
		a := make([]any, len(aliases))
		for i, x := range aliases {
			a[i] = x
		}
		return w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": name, "aliases": a, "defaultCurrency": "USD"}}).expect(201)
	}
	alpha, beta := mk("Alpha", "alpha co"), mk("Beta")
	aid, bid := alpha.String("id"), beta.String("id")

	// Typed names that match an active vendor are resolved when the item is written.
	b0, _ := w.openBatch(t, "Write time")
	typed := w.do(t, call{token: w.mem, method: "POST", path: w.path("/batches/{}", b0) + "/items", body: withVendor("typed", map[string]any{"vendorName": " ALPHA CO "})}).expect(201)
	if typed.String("vendorId") != aid || typed.String("vendorName") != "Alpha" {
		t.Fatalf("typed alias not resolved on create: %s", typed.Body)
	}
	edited := w.do(t, call{token: w.mem, method: "PUT", path: w.path("/items/{}", typed.String("id")), ifMatch: typed.ETag(), body: withVendor("typed", map[string]any{"vendorName": "beta"})}).expect(200)
	if edited.String("vendorId") != bid {
		t.Fatalf("typed name not resolved on edit: %s", edited.Body)
	}
	w.do(t, call{token: w.mem, method: "PUT", path: w.path("/items/{}", typed.String("id")), ifMatch: edited.ETag(), body: withVendor("typed", map[string]any{"vendorName": "Nobody"})}).expect(200)

	ids := w.confirmedBatchWith(t, "Round",
		withVendor("a1", map[string]any{"vendorId": aid}),
		withVendor("b1", map[string]any{"vendorId": bid}),
		withVendor("o2", map[string]any{"vendorName": "Zed"}),
		withVendor("o1", map[string]any{"vendorName": "Local shop"}),
	)
	_ = ids

	// Beta is deactivated and an alias equal to an open item's typed name is added to Alpha later.
	put := func(v *result, name string, aliases []any, active bool) {
		w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendors/{}", v.String("id")), ifMatch: v.ETag(),
			body: map[string]any{"name": name, "aliases": aliases, "defaultCurrency": "USD", "active": active}}).expect(200)
	}
	put(beta, "Beta", []any{}, false)
	put(alpha, "Alpha", []any{"alpha co", "zed"}, true)

	type group struct {
		id       any
		name     any
		inactive bool
		count    int
	}
	want := []group{{aid, "Alpha", false, 1}, {bid, "Beta", true, 1}, {nil, nil, false, 2}}

	q := w.do(t, call{token: buyer, method: "GET", path: "/api/v1/purchasing/queue"}).expect(200).Items()
	if len(q) != len(want) {
		t.Fatalf("queue groups = %d: %v", len(q), q)
	}
	for i, g := range q {
		m := g.(map[string]any)
		name := any(m["vendorName"])
		if m["vendorId"] == nil {
			name = nil
			// "Other" lists its items by typed vendor name.
			its := m["items"].([]any)
			if its[0].(map[string]any)["vendorName"] != "Local shop" || its[1].(map[string]any)["vendorName"] != "Zed" {
				t.Errorf("other items = %v", its)
			}
		}
		got := group{m["vendorId"], name, m["inactive"] == true, len(m["items"].([]any))}
		if got != want[i] {
			t.Errorf("queue group %d = %+v, want %+v", i, got, want[i])
		}
	}
	tasks := w.do(t, call{token: buyer, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["itemsToPurchase"].([]any)
	if len(tasks) != len(want) {
		t.Fatalf("task groups = %d: %v", len(tasks), tasks)
	}
	for i, g := range tasks {
		m := g.(map[string]any)
		got := group{m["vendorId"], m["vendor"], m["inactive"] == true, int(m["count"].(float64))}
		if got != want[i] {
			t.Errorf("task group %d = %+v, want %+v", i, got, want[i])
		}
	}
}

// A draft order's currency changes only without with-checkout entries; the unit prices are cleared and audited.
func TestHTTPVendorOrderCurrencyChange(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(201)
	op := w.path("/vendor-orders/{}", o.String("id"))
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/lines", ifMatch: o.ETag(), body: map[string]any{"teamId": w.teamID, "name": "cable", "quantity": 2, "unitPrice": "10.00"}}).expect(201)
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/cost-entries", ifMatch: o.ETag(), body: costBody("fee", "separate", "JPY", "100", "", nil)}).expect(201)
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/cost-entries", ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "3", "", nil)}).expect(201)
	shipping := entryIDs(o.JSON())[1]
	body := map[string]any{"vendorId": vendor.String("id"), "currency": "TWD", "ownerIds": []string{}}

	blocked := w.do(t, call{token: buyer, method: "PUT", path: op, ifMatch: o.ETag(), body: body}).expect(422, "currency_change_blocked")
	es := blocked.JSON()["error"].(map[string]any)["details"].(map[string]any)["entries"].([]any)
	if len(es) != 1 || es[0].(map[string]any)["entryNo"] != float64(2) || es[0].(map[string]any)["type"] != "shipping" || es[0].(map[string]any)["currency"] != "USD" {
		t.Fatalf("details.entries = %v", es)
	}
	if l := w.do(t, call{token: buyer, method: "GET", path: op}).expect(200).JSON()["lines"].([]any)[0].(map[string]any); l["unitPrice"] != "10" {
		t.Fatalf("a refused change must not touch the prices: %v", l)
	}

	o = w.do(t, call{token: buyer, method: "DELETE", path: w.path("/cost-entries/{}", shipping), ifMatch: o.ETag()}).expect(200)
	o = w.do(t, call{token: buyer, method: "PUT", path: op, ifMatch: o.ETag(), body: body}).expect(200)
	l := o.JSON()["lines"].([]any)[0].(map[string]any)
	if o.String("currency") != "TWD" || l["unitPrice"] != nil || l["lineC"] != nil {
		t.Fatalf("after the change: %s", o.Body)
	}
	if es := o.JSON()["costEntries"].([]any); len(es) != 1 || es[0].(map[string]any)["currency"] != "JPY" {
		t.Errorf("separate entry should stay: %v", es)
	}
	found := false
	for _, ev := range w.do(t, call{token: buyer, method: "GET", path: "/api/v1/audit?objectType=vendor_order&objectId=" + o.String("id")}).expect(200).Items() {
		for _, c := range ev.(map[string]any)["changes"].([]any) {
			if c.(map[string]any)["field"] == "unitPrices" {
				from := c.(map[string]any)["from"].(map[string]any)
				found = from["#1"] == "10"
			}
		}
	}
	if !found {
		t.Errorf("audit event with the old prices not found")
	}
}

// Values are null one by one, flags sit where they apply, and a cancelled order has only lineC and the order-currency totals.
func TestHTTPVendorOrderPartialAmounts(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "TWD"}}).expect(201)
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(201)
	op := w.path("/vendor-orders/{}", o.String("id"))
	line := func(name string, price any) {
		b := map[string]any{"teamId": w.teamID, "name": name, "quantity": 1}
		if price != nil {
			b["unitPrice"] = price
		}
		o = w.do(t, call{token: buyer, method: "POST", path: op + "/lines", ifMatch: o.ETag(), body: b}).expect(201)
	}
	// Rates are applied by a background job; any write to the order recomputes it as well.
	touch := func() {
		o = w.do(t, call{token: buyer, method: "GET", path: op}).expect(200)
		o = w.do(t, call{token: buyer, method: "PUT", path: op, ifMatch: o.ETag(), body: map[string]any{"vendorId": vendor.String("id"), "currency": "TWD", "ownerIds": []string{}}}).expect(200)
	}
	tot := func() map[string]any { return o.JSON()["totals"].(map[string]any) }
	ln := func(i int) map[string]any { return o.JSON()["lines"].([]any)[i].(map[string]any) }

	// A draft without a reference rate still shows the order-currency amounts.
	line("a", "100")
	if tot()["linesC"] != "100" || tot()["originalC"] != "100" || tot()["factor"] != nil || ln(0)["lineC"] != "100" || ln(0)["costBase"] != nil {
		t.Fatalf("no rate: %s", o.Body)
	}
	// A line without a price nulls the totals and every base field.
	line("b", nil)
	if ln(1)["lineC"] != nil || tot()["linesC"] != nil || tot()["checkoutC"] != nil || tot()["originalC"] != nil || ln(0)["lineC"] != "100" {
		t.Fatalf("missing price: %s", o.Body)
	}
	o = w.do(t, call{token: buyer, method: "PUT", path: w.path("/vendor-order-lines/{}", ln(1)["id"].(string)), ifMatch: o.ETag(), body: map[string]any{
		"teamId": ln(1)["teamId"], "name": "b", "quantity": 1, "unitPrice": "100"}}).expect(200)

	// One separate entry without a rate: costBase and sharedBase stay, separateBase, totalBase and netBase do not.
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/cost-entries", ifMatch: o.ETag(), body: costBody("fee", "separate", "JPY", "500", "", nil)}).expect(201)
	w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/TWD", body: map[string]any{"rateToBase": "0.5"}}).expect(201)
	touch()
	if ln(0)["costBase"] != "50" || ln(0)["sharedBase"] != "0" || ln(0)["totalBase"] != nil || ln(0)["separateBase"] != nil || tot()["netBase"] != nil || tot()["targetBase"] != "100" {
		t.Fatalf("one entry without E: %s", o.Body)
	}
	if e := o.JSON()["costEntries"].([]any)[0].(map[string]any); e["amountBase"] != nil || e["provisional"] != false {
		t.Fatalf("entry computed fields: %v", e)
	}
	// A provisional factor marks every line's cost, and only that.
	if tot()["factorProvisional"] != true || ln(0)["costProvisional"] != true || ln(1)["costProvisional"] != true || ln(0)["separateProvisional"] != false {
		t.Fatalf("factor flags: %s", o.Body)
	}

	// A separate entry on a reference rate marks the lines it is allocated to, not their cost.
	w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/JPY", body: map[string]any{"rateToBase": "0.01"}}).expect(201)
	touch()
	if e := o.JSON()["costEntries"].([]any)[0].(map[string]any); e["amountBase"] != "5" || e["provisional"] != true {
		t.Fatalf("entry computed fields: %v", e)
	}
	if ln(0)["separateProvisional"] != true || ln(0)["totalBase"] == nil || tot()["netBase"] == nil || o.JSON()["invariantOk"] != true {
		t.Fatalf("after the JPY rate: %s", o.Body)
	}

	// Cancelled: lineC and the order-currency totals stay, the base-currency values and flags go.
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/cancel", ifMatch: o.ETag(), body: map[string]any{"reason": "not needed"}}).expect(200)
	if ln(0)["lineC"] != "100" || tot()["linesC"] != "200" || tot()["netBase"] != nil || tot()["factor"] != nil || tot()["provisional"] != false || ln(0)["costBase"] != nil ||
		ln(0)["totalBase"] != nil || ln(0)["costProvisional"] != false || len(tot()["incomplete"].([]any)) != 0 {
		t.Fatalf("cancelled: %s", o.Body)
	}
}
