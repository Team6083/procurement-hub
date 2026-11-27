package app

import "testing"

func costBody(typ, settlement, currency, amount, note string, extra map[string]any) map[string]any {
	b := map[string]any{"type": typ, "settlement": settlement, "currency": currency, "amount": amount, "note": note}
	for k, v := range extra {
		b[k] = v
	}
	return b
}

func entryIDs(o map[string]any) []string {
	var out []string
	for _, e := range o["costEntries"].([]any) {
		out = append(out, e.(map[string]any)["id"].(string))
	}
	return out
}

// Draft orders: create, update, delete, validation errors, allocation checks
// and the allocation reset when a line disappears.
func TestHTTPCostEntriesInDraft(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	vendor := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendors", body: map[string]any{"name": "WCP", "aliases": []string{}, "defaultCurrency": "USD"}}).expect(201)
	o := w.do(t, call{token: buyer, method: "POST", path: "/api/v1/vendor-orders", body: map[string]any{"vendorId": vendor.String("id")}}).expect(201)
	op := w.path("/vendor-orders/{}", o.String("id"))
	o = w.do(t, call{token: buyer, method: "POST", path: op + "/lines", ifMatch: o.ETag(), body: map[string]any{
		"teamId": w.teamID, "name": "cable", "quantity": 1, "unitPrice": "10.00"}}).expect(201)
	lineID := o.JSON()["lines"].([]any)[0].(map[string]any)["id"].(string)
	cp := op + "/cost-entries"

	// Refunds need a placed order; non-purchasers may not write; the version is checked.
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("refund", "separate", "USD", "-2", "back", map[string]any{"refundMethod": "cash"})}).expect(422, "order_not_placed")
	w.do(t, call{token: w.mem, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "3", "", nil)}).expect(403, "forbidden")
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: `"999"`, body: costBody("shipping", "with_checkout", "USD", "3", "", nil)}).expect(409, "version_conflict")

	// Field errors: sign, digits, with_checkout currency, missing note.
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("discount", "with_checkout", "USD", "2", "", nil)}).expect(400, "invalid_request")
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "3.123", "", nil)}).expect(400, "invalid_request")
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "TWD", "3", "", nil)}).expect(400, "invalid_request")
	w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("other", "with_checkout", "USD", "3", "", nil)}).expect(400, "invalid_request")

	// Create, then fix the amount.
	o = w.do(t, call{token: buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "3", "", nil)}).expect(201)
	id := entryIDs(o.JSON())[0]
	if c := o.JSON()["totals"].(map[string]any)["checkoutC"]; c != "3" {
		t.Fatalf("checkoutC = %v", c)
	}
	ep := w.path("/cost-entries/{}", id)
	o = w.do(t, call{token: buyer, method: "PUT", path: ep, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "4", "", nil)}).expect(200)
	if c := o.JSON()["totals"].(map[string]any)["checkoutC"]; c != "4" {
		t.Fatalf("checkoutC after update = %v", c)
	}

	// An allocation naming a line that is not on the order is 422; a valid one is stored.
	bad := map[string]any{"allocation": map[string]any{"mode": "lines", "lineIds": []string{"000000000000000000000001"}}}
	w.do(t, call{token: buyer, method: "PUT", path: ep, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "4", "x", bad)}).expect(422, "shared_cost_allocation_invalid")
	good := map[string]any{"allocation": map[string]any{"mode": "lines", "lineIds": []string{lineID}}}
	o = w.do(t, call{token: buyer, method: "PUT", path: ep, ifMatch: o.ETag(), body: costBody("shipping", "with_checkout", "USD", "4", "for the cable", good)}).expect(200)

	// Removing the line resets the entry to all and says so.
	o = w.do(t, call{token: buyer, method: "DELETE", path: w.path("/vendor-order-lines/{}", lineID), ifMatch: o.ETag()}).expect(200)
	if o.JSON()["allocationsReset"] != true {
		t.Fatalf("allocationsReset missing: %s", o.Body)
	}
	if m := o.JSON()["costEntries"].([]any)[0].(map[string]any)["allocation"].(map[string]any)["mode"]; m != "all" {
		t.Fatalf("allocation mode after reset = %v", m)
	}

	// Draft entries are voided by deleting, not by void.
	w.do(t, call{token: buyer, method: "POST", path: ep + "/void", ifMatch: o.ETag(), body: map[string]any{"reason": "x"}}).expect(422, "order_not_placed")
	o = w.do(t, call{token: buyer, method: "DELETE", path: ep, ifMatch: o.ETag()}).expect(200)
	if n := len(entryIDs(o.JSON())); n != 0 {
		t.Fatalf("entries after delete = %d", n)
	}
}

// Placed orders: refunds, voiding, unplace blockers, closure refunds in another currency.
func TestHTTPCostEntriesAfterPlacing(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)
	cp := f.orderPath + "/cost-entries"
	o := w.do(t, call{token: f.buyer, method: "GET", path: f.orderPath}).expect(200)

	// A refund (any supported currency, separate) and a tax with the checkout.
	o = w.do(t, call{token: f.buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("refund", "separate", "TWD", "-300", "vendor refunded", map[string]any{"refundMethod": "coupon"})}).expect(201)
	refund := entryIDs(o.JSON())[0]
	if inc := o.JSON()["totals"].(map[string]any)["incomplete"].([]any); len(inc) == 0 {
		t.Errorf("a TWD refund without a rate should make the order incomplete: %s", o.Body)
	}
	o = w.do(t, call{token: f.buyer, method: "POST", path: cp, ifMatch: o.ETag(), body: costBody("tax", "with_checkout", "USD", "1", "", nil)}).expect(201)
	tax := entryIDs(o.JSON())[1]

	// Actual base amount filled in later, same sign as the amount: no longer provisional or incomplete.
	o = w.do(t, call{token: f.buyer, method: "PUT", path: w.path("/cost-entries/{}", refund), ifMatch: o.ETag(),
		body: costBody("refund", "separate", "TWD", "-300", "vendor refunded", map[string]any{"refundMethod": "coupon", "actualAmountBase": "-9.50"})}).expect(200)
	if o.JSON()["totals"].(map[string]any)["separateBase"] != "-9.5" {
		t.Errorf("separateBase = %v", o.JSON()["totals"])
	}
	// Lines carry lineC (quantity x unit price, exact) in the order currency.
	if l := o.JSON()["lines"].([]any)[0].(map[string]any); l["lineC"] != "10" {
		t.Errorf("lineC = %v, want 10", l["lineC"])
	}
	// The refund's base amount is the actual one, not provisional.
	if e := o.JSON()["costEntries"].([]any)[0].(map[string]any); e["amountBase"] != "-9.5" || e["provisional"] != false {
		t.Errorf("refund amountBase/provisional = %v / %v", e["amountBase"], e["provisional"])
	}

	// Deleting needs a draft; unplace is blocked by the refund but not by the tax.
	w.do(t, call{token: f.buyer, method: "DELETE", path: w.path("/cost-entries/{}", tax), ifMatch: o.ETag()}).expect(422, "order_not_draft")
	b := w.do(t, call{token: f.buyer, method: "POST", path: f.orderPath + "/unplace", ifMatch: o.ETag(), body: map[string]any{"reason": "oops"}}).expect(409, "blocked_by_dependency")
	if bl := b.JSON()["error"].(map[string]any)["details"].(map[string]any)["blockers"].([]any); len(bl) != 1 || bl[0].(map[string]any)["type"] != "cost_entry" {
		t.Fatalf("blockers = %v", bl)
	}
	o = w.do(t, call{token: f.buyer, method: "POST", path: w.path("/cost-entries/{}/void", refund), ifMatch: o.ETag(), body: map[string]any{"reason": "wrong order"}}).expect(200)
	if v := o.JSON()["costEntries"].([]any)[0].(map[string]any)["voided"]; v == nil {
		t.Fatalf("refund not voided: %s", o.Body)
	}
	w.do(t, call{token: f.buyer, method: "PUT", path: w.path("/cost-entries/{}", refund), ifMatch: o.ETag(),
		body: costBody("refund", "separate", "TWD", "-300", "n", map[string]any{"refundMethod": "cash"})}).expect(422, "cost_entry_voided")
	w.do(t, call{token: f.buyer, method: "POST", path: w.path("/cost-entries/{}/void", refund), ifMatch: o.ETag(), body: map[string]any{"reason": "again"}}).expect(422, "cost_entry_voided")
	o = w.do(t, call{token: f.buyer, method: "POST", path: f.orderPath + "/unplace", ifMatch: o.ETag(), body: map[string]any{"reason": "oops"}}).expect(200)
	if o.String("status") != "draft" {
		t.Fatalf("status = %s", o.String("status"))
	}
}

// A closure refund is a separate entry with its own currency; it cannot be
// voided directly, only by reopening the line. Bad refund bodies are 400.
func TestHTTPClosureRefundEntry(t *testing.T) {
	w := setup(t)
	f := w.placedOrder(t)
	d := w.do(t, call{token: f.recv, method: "POST", path: "/api/v1/deliveries", body: map[string]any{
		"lines": []map[string]any{{"name": "motor", "goodQuantity": 1}}}}).expect(201)
	dl := d.JSON()["lines"].([]any)[0].(map[string]any)
	w.do(t, call{token: f.recv, method: "PUT", path: w.path("/delivery-lines/{}/matches", dl["id"].(string)), ifMatch: d.ETag(),
		body: map[string]any{"matches": []map[string]any{{"vendorOrderLineId": f.lineID, "goodQuantity": 1, "problemQuantity": 0}}}}).expect(200)
	lp := w.path("/vendor-order-lines/{}", f.lineID)
	o := w.do(t, call{token: f.buyer, method: "GET", path: f.orderPath}).expect(200)

	refund := func(m map[string]any) map[string]any { return m }
	w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), skipRequestValidation: true, body: map[string]any{
		"type": "short_accepted", "reason": "short", "refund": refund(map[string]any{"currency": "TWD", "amount": "-100", "method": "cash"})}}).expect(400, "invalid_request")
	w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), body: map[string]any{
		"type": "short_accepted", "reason": "short", "refund": map[string]any{"currency": "EUR", "amount": "100", "method": "cash"}}}).expect(400, "invalid_request")
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/close", ifMatch: o.ETag(), body: map[string]any{
		"type": "short_accepted", "reason": "short", "refund": map[string]any{"currency": "TWD", "amount": "100", "actualAmountBase": "3.1", "method": "coupon", "note": "store credit"}}}).expect(200)
	e := o.JSON()["costEntries"].([]any)[0].(map[string]any)
	if e["amount"] != "-100" || e["currency"] != "TWD" || e["settlement"] != "separate" || e["source"] != "closure" ||
		e["refundMethod"] != "coupon" || e["actualAmountBase"] != "-3.1" || e["note"] != "store credit" {
		t.Fatalf("closure entry = %v", e)
	}
	if lines := e["allocation"].(map[string]any)["lineIds"].([]any); len(lines) != 1 || lines[0] != f.lineID {
		t.Fatalf("closure entry allocation = %v", e["allocation"])
	}
	w.do(t, call{token: f.buyer, method: "POST", path: w.path("/cost-entries/{}/void", e["id"].(string)), ifMatch: o.ETag(), body: map[string]any{"reason": "x"}}).expect(409, "blocked_by_dependency")
	o = w.do(t, call{token: f.buyer, method: "POST", path: lp + "/reopen", ifMatch: o.ETag(), body: map[string]any{"reason": "more coming"}}).expect(200)
	if e := o.JSON()["costEntries"].([]any)[0].(map[string]any); e["voided"] == nil {
		t.Errorf("closure refund should be voided after reopening: %v", e)
	}
}
