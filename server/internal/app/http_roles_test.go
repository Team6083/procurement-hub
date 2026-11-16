package app

import "testing"

// Purchaser and receiver are global roles read from the token; system admins
// do not get them, and /users?role= lists candidates from roleSnapshot.
func TestHTTPPurchaserReceiverRoles(t *testing.T) {
	w := setup(t)
	buyer := w.userWithRoles(t, "buyer", false, []string{"purchaser"})
	recv := w.userWithRoles(t, "recv", false, []string{"receiver"})

	me := func(tok string) map[string]any {
		return w.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(200).JSON()
	}
	if m := me(buyer); m["isPurchaser"] != true || m["isReceiver"] != false {
		t.Errorf("buyer: %v", m)
	}
	if m := me(recv); m["isPurchaser"] != false || m["isReceiver"] != true {
		t.Errorf("receiver: %v", m)
	}
	if m := me(w.root); m["isSystemAdmin"] != true || m["isPurchaser"] != false || m["isReceiver"] != false {
		t.Errorf("system admin must not imply purchasing roles: %v", m)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/users?q=bu&role=purchaser"}).expect(200).Items()); n != 1 {
		t.Errorf("purchaser candidates = %d, want 1", n)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/users?q=re&role=purchaser"}).expect(200).Items()); n != 0 {
		t.Errorf("a receiver is not a purchaser candidate, got %d", n)
	}
	// A purchaser who is on no team may still search.
	w.do(t, call{token: buyer, method: "GET", path: "/api/v1/users?q=re&role=receiver"}).expect(200)
	w.do(t, call{token: w.outsider, method: "GET", path: "/api/v1/users?q=re"}).expect(403, "forbidden")

	// Assigning a purchaser: must carry the role in roleSnapshot; grants nothing.
	id, b := w.openBatch(t, "Round P")
	buyerID := w.do(t, call{token: buyer, method: "GET", path: "/api/v1/me"}).String("id")
	w.do(t, call{token: w.adm, method: "PUT", path: w.path("/batches/{}", id) + "/assignments", ifMatch: b.ETag(),
		body: map[string]any{"approvers": []string{w.apprID}, "purchasers": []string{w.memID}}}).expect(400, "invalid_request")
	w.do(t, call{token: w.adm, method: "PUT", path: w.path("/batches/{}", id) + "/assignments", ifMatch: b.ETag(),
		body: map[string]any{"approvers": []string{w.apprID}, "purchasers": []string{buyerID}}}).expect(200)
}
