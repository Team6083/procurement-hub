package app

import (
	"testing"
	"time"

	"github.com/team6083/procurement-hub/server/internal/service"
)

func deadline(h int) string {
	return time.Now().UTC().Add(time.Duration(h) * time.Hour).Format(time.RFC3339)
}

// openBatch creates a draft, sets assignments and opens it for collection.
func (w *world) openBatch(t *testing.T, title string) (id string, version *result) {
	t.Helper()
	b := w.do(t, call{token: w.adm, method: "POST", path: w.path("/teams/{}/batches", w.teamID), body: map[string]any{"title": title}}).expect(201)
	id = b.String("id")
	if b.String("status") != "draft" {
		t.Fatalf("status = %s", b.String("status"))
	}
	p := w.path("/batches/{}", id)
	b = w.do(t, call{token: w.adm, method: "PATCH", path: p, ifMatch: b.ETag(), body: map[string]any{"deadline": deadline(48)}}).expect(200)
	b = w.do(t, call{token: w.adm, method: "PUT", path: p + "/assignments", ifMatch: b.ETag(), body: map[string]any{
		"approvers": []string{w.apprID}, "purchasers": []string{}}}).expect(200)
	b = w.do(t, call{token: w.adm, method: "POST", path: p + "/transitions", ifMatch: b.ETag(), body: map[string]any{"action": "open"}}).expect(200)
	if b.String("status") != "collecting" {
		t.Fatalf("status = %s", b.String("status"))
	}
	return id, b
}

// The whole review flow over HTTP (acceptance criteria 2 and 3).
func TestHTTPBatchLifecycle(t *testing.T) {
	w := setup(t)
	id, _ := w.openBatch(t, "Round 1")
	bp := w.path("/batches/{}", id)

	// Adding items: members only; outsiders can read a public batch but not write.
	w.do(t, call{token: w.outsider, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.outsider, method: "POST", path: bp + "/items", body: itemBody("x")}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "POST", path: bp + "/items", body: itemBody("x")}).expect(403, "forbidden") // not a member
	var itemIDs []string
	var first *result
	for _, n := range []string{"a", "b", "c", "d"} {
		it := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody(n)}).expect(201)
		itemIDs = append(itemIDs, it.String("id"))
		if first == nil {
			first = it
		}
	}
	if n := len(w.do(t, call{token: w.outsider, method: "GET", path: bp + "/items"}).expect(200).Items()); n != 4 {
		t.Fatalf("items = %d", n)
	}

	// Validation errors name the offending fields.
	bad := itemBody("bad")
	bad["quantity"] = 0
	bad["estimatedUnitPrice"] = map[string]any{"amount": "1.234", "currency": "USD"}
	v := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: bad, skipRequestValidation: true}).expect(400, "invalid_request")
	fields := v.JSON()["error"].(map[string]any)["details"].(map[string]any)["fields"].(map[string]any)
	if fields["quantity"] == nil || fields["estimatedUnitPrice"] == nil {
		t.Errorf("field errors = %v", fields)
	}
	jp := itemBody("yen")
	jp["estimatedUnitPrice"] = map[string]any{"amount": "100.5", "currency": "JPY"}
	w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: jp}).expect(400, "invalid_request")

	// PUT replaces all editable fields and needs If-Match.
	ip := w.path("/items/{}", itemIDs[0])
	edit := itemBody("a renamed")
	w.do(t, call{token: w.mem, method: "PUT", path: ip, body: edit, skipRequestValidation: true}).expect(428, "if_match_required")
	got := w.do(t, call{token: w.mem, method: "PUT", path: ip, ifMatch: first.ETag(), body: edit}).expect(200)
	if got.String("name") != "a renamed" {
		t.Errorf("name = %s", got.String("name"))
	}
	w.do(t, call{token: w.mem, method: "PUT", path: ip, ifMatch: first.ETag(), body: edit}).expect(409, "version_conflict")
	// System admins may edit any pending item while collecting, though they are not members.
	got = w.do(t, call{token: w.root, method: "PUT", path: ip, ifMatch: got.ETag(), body: itemBody("a by sysadmin")}).expect(200)
	w.do(t, call{token: w.appr, method: "PUT", path: ip, ifMatch: got.ETag(), body: edit}).expect(403, "forbidden")

	// Close collection -> reviewing; adding is no longer possible (except related items, spec §10.2).
	batch := w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: w.do(t, call{token: w.adm, method: "GET", path: bp}).ETag(), body: map[string]any{"action": "close"}}).expect(200)
	if batch.String("status") != "reviewing" {
		t.Fatalf("status = %s", batch.String("status"))
	}
	w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("late")}).expect(403, "forbidden")
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: batch.ETag(), body: map[string]any{"action": "close"}}).expect(409, "invalid_transition")

	// Review: a plain member may not; returning requires a comment; all-or-nothing.
	decide := func(d ...map[string]any) map[string]any { return map[string]any{"decisions": d} }
	one := func(id, dec, comment string) map[string]any {
		m := map[string]any{"itemId": id, "decision": dec}
		if comment != "" {
			m["comment"] = comment
		}
		return m
	}
	rp := bp + "/reviews"
	w.do(t, call{token: w.mem, method: "POST", path: rp, body: decide(one(itemIDs[0], "approve", ""))}).expect(403, "forbidden")
	w.do(t, call{token: w.appr, method: "POST", path: rp, body: decide(one(itemIDs[0], "approve", ""), one(itemIDs[1], "return", ""))}).expect(400, "invalid_request")
	res := w.do(t, call{token: w.appr, method: "POST", path: rp, body: decide(
		one(itemIDs[0], "approve", ""), one(itemIDs[1], "approve", ""),
		one(itemIDs[2], "return", "which model?"), one(itemIDs[3], "reject", "not needed"))}).expect(200)
	if res.String("batch", "status") != "reviewing" {
		t.Fatalf("batch must wait for the returned item: %s", res.Body)
	}

	// Resubmitting needs an edit first; then the approver confirms the review and the batch moves to purchasing.
	ret := w.do(t, call{token: w.mem, method: "GET", path: bp + "/items"}).expect(200)
	var returned map[string]any
	for _, it := range ret.Items() {
		if m := it.(map[string]any); m["id"] == itemIDs[2] {
			returned = m
		}
	}
	rip := w.path("/items/{}", itemIDs[2])
	ver := `"` + itoa(int(returned["version"].(float64))) + `"`
	w.do(t, call{token: w.mem, method: "POST", path: rip + "/resubmit", ifMatch: ver}).expect(422, "item_not_edited")
	edited := w.do(t, call{token: w.mem, method: "PUT", path: rip, ifMatch: ver, body: itemBody("c clarified")}).expect(200)
	resub := w.do(t, call{token: w.mem, method: "POST", path: rip + "/resubmit", ifMatch: edited.ETag()}).expect(200)
	if resub.String("status") != "pending" {
		t.Fatalf("status = %s", resub.String("status"))
	}
	if n := len(w.do(t, call{token: w.appr, method: "GET", path: "/api/v1/me/tasks"}).expect(200).JSON()["itemsToReview"].([]any)); n != 1 {
		t.Errorf("itemsToReview = %d", n)
	}
	res = w.do(t, call{token: w.appr, method: "POST", path: rp, body: decide(one(itemIDs[2], "approve", ""))}).expect(200)
	if res.String("batch", "status") != "reviewing" {
		t.Fatalf("batch should wait for confirmation: %s", res.Body)
	}
	conf := w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: res.ETag(), body: map[string]any{"action": "confirm_review"}}).expect(200)
	if conf.String("status") != "purchasing" {
		t.Fatalf("batch should be purchasing: %s", conf.Body)
	}
	w.do(t, call{token: w.appr, method: "POST", path: rp, body: decide(one(itemIDs[0], "reject", "again"))}).expect(422, "batch_not_reviewing")
}

func TestHTTPForceRejectWithdrawAndTasks(t *testing.T) {
	w := setup(t)
	id, _ := w.openBatch(t, "Round 2")
	bp := w.path("/batches/{}", id)
	a := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("a")}).expect(201)
	b := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("b")}).expect(201)

	// Withdraw own item while collecting.
	wd := w.do(t, call{token: w.mem, method: "POST", path: w.path("/items/{}", b.String("id")) + "/withdraw", ifMatch: b.ETag()}).expect(200)
	if wd.String("status") != "withdrawn" {
		t.Fatalf("status = %s", wd.String("status"))
	}

	ver := w.do(t, call{token: w.adm, method: "GET", path: bp}).ETag()
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: ver, body: map[string]any{"action": "close"}}).expect(200)

	fr := w.path("/items/{}", a.String("id")) + "/force-reject"
	w.do(t, call{token: w.appr, method: "POST", path: fr, ifMatch: a.ETag(), body: map[string]any{"reason": "x"}}).expect(403, "forbidden")
	w.do(t, call{token: w.adm, method: "POST", path: fr, ifMatch: a.ETag(), body: map[string]any{"reason": ""}, skipRequestValidation: true}).expect(400, "invalid_request")
	w.do(t, call{token: w.adm, method: "POST", path: fr, ifMatch: a.ETag(), body: map[string]any{"reason": "duplicate"}}).expect(200)
	// The only live item was rejected; confirming the review completes the batch.
	cur := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	if st := w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: cur.ETag(), body: map[string]any{"action": "confirm_review"}}).expect(200).String("status"); st != "completed" {
		t.Errorf("batch status = %s", st)
	}
}

func TestHTTPProposalsAndTasks(t *testing.T) {
	w := setup(t)
	p := w.do(t, call{token: w.mem, method: "POST", path: w.path("/teams/{}/batches", w.teamID), body: map[string]any{"title": "Please buy", "propose": true}}).expect(201)
	if p.String("status") != "proposed" {
		t.Fatalf("status = %s", p.String("status"))
	}
	tasks := w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/me/tasks"}).expect(200)
	if n := len(tasks.JSON()["proposalsToHandle"].([]any)); n != 1 {
		t.Errorf("proposalsToHandle = %d", n)
	}
	bp := w.path("/batches/{}", p.String("id"))
	w.do(t, call{token: w.appr, method: "POST", path: bp + "/transitions", ifMatch: p.ETag(), body: map[string]any{"action": "withdraw_proposal"}}).expect(403, "forbidden")
	w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: p.ETag(), body: map[string]any{"action": "reject_proposal"}}).expect(422, "reason_required")
	rej := w.do(t, call{token: w.adm, method: "POST", path: bp + "/transitions", ifMatch: p.ETag(), body: map[string]any{"action": "reject_proposal", "reason": "no budget"}}).expect(200)
	if rej.String("status") != "proposal_rejected" || rej.String("statusReason") != "no budget" {
		t.Errorf("rejected proposal: %s", rej.Body)
	}
}

// Visibility (acceptance criterion 6) through the HTTP layer.
func TestHTTPVisibility(t *testing.T) {
	w := setup(t)
	id, _ := w.openBatch(t, "Hidden round")
	bp := w.path("/batches/{}", id)
	cur := w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}", w.teamID)}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: w.path("/teams/{}", w.teamID), ifMatch: cur.ETag(), body: map[string]any{"visibility": "members"}}).expect(200)

	w.do(t, call{token: w.outsider, method: "GET", path: bp}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "GET", path: bp + "/items"}).expect(404, "not_found")
	w.do(t, call{token: w.outsider, method: "GET", path: "/api/v1/audit?objectType=batch&objectId=" + id}).expect(404, "not_found")
	if n := len(w.do(t, call{token: w.outsider, method: "GET", path: "/api/v1/batches"}).expect(200).Items()); n != 0 {
		t.Errorf("outsider sees %d batches", n)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/batches"}).expect(200).Items()); n != 1 {
		t.Errorf("member sees %d batches", n)
	}
	// A batch override can make one batch public again.
	b := w.do(t, call{token: w.adm, method: "GET", path: bp}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: bp, ifMatch: b.ETag(), body: map[string]any{"visibilityOverride": "public"}}).expect(200)
	w.do(t, call{token: w.outsider, method: "GET", path: bp}).expect(200)
}

// Pagination rules of spec §16.1.
func TestHTTPPagination(t *testing.T) {
	w := setup(t)
	for _, n := range []string{"one", "two", "three"} {
		w.do(t, call{token: w.adm, method: "POST", path: w.path("/teams/{}/batches", w.teamID), body: map[string]any{"title": n}}).expect(201)
	}
	bad := w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/batches?limit=abc", skipRequestValidation: true}).expect(400, "invalid_request")
	if f := bad.JSON()["error"].(map[string]any)["details"].(map[string]any)["fields"].(map[string]any); f["limit"] == nil {
		t.Errorf("limit error fields = %v", f)
	}
	w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/batches?limit=0", skipRequestValidation: true}).expect(400, "invalid_request")
	w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/batches?limit=1000", skipRequestValidation: true}).expect(200) // clamped to 100

	seen := map[string]bool{}
	cursor, pages := "", 0
	for {
		path := "/api/v1/batches?limit=2"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		pg := w.do(t, call{token: w.adm, method: "GET", path: path}).expect(200)
		for _, it := range pg.Items() {
			id := it.(map[string]any)["id"].(string)
			if seen[id] {
				t.Fatalf("batch %s returned twice", id)
			}
			seen[id] = true
		}
		pages++
		next, _ := pg.JSON()["nextCursor"].(string)
		if next == "" {
			break
		}
		cursor = next
	}
	if len(seen) != 3 || pages != 2 {
		t.Errorf("seen %d batches in %d pages, want 3 in 2", len(seen), pages)
	}

	// Unpaginated lists are a plain {items} object.
	for _, p := range []string{"/api/v1/teams", w.path("/teams/{}/members", w.teamID)} {
		body := w.do(t, call{token: w.adm, method: "GET", path: p}).expect(200).JSON()
		if _, has := body["nextCursor"]; has || body["items"] == nil || len(body) != 1 {
			t.Errorf("%s is not a plain {items} list: %v", p, body)
		}
	}
}

func TestHTTPAuditPagination(t *testing.T) {
	w := setup(t)
	id, _ := w.openBatch(t, "Audited")
	bp := w.path("/batches/{}", id)
	for _, n := range []string{"a", "b", "c"} {
		w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody(n)}).expect(201)
	}
	collect := func(path string) []map[string]any {
		var all []map[string]any
		cursor := ""
		for i := 0; i < 20; i++ {
			p := path + "&limit=3"
			if cursor != "" {
				p += "&cursor=" + cursor
			}
			pg := w.do(t, call{token: w.mem, method: "GET", path: p}).expect(200)
			for _, e := range pg.Items() {
				all = append(all, e.(map[string]any))
			}
			if cursor, _ = pg.JSON()["nextCursor"].(string); cursor == "" {
				return all
			}
		}
		t.Fatal("pagination did not terminate")
		return nil
	}
	evs := collect("/api/v1/audit?objectType=batch&objectId=" + id)
	// created, assignments, deadline update, open, + 3 item.created
	if len(evs) < 7 {
		t.Fatalf("timeline has %d events", len(evs))
	}
	var sawItem bool
	for i, e := range evs {
		if e["action"] == "item.created" {
			sawItem = true
		}
		if i > 0 && evs[i-1]["id"] == e["id"] {
			t.Fatal("duplicate event across pages")
		}
	}
	if !sawItem {
		t.Error("batch timeline must include item events")
	}
	if e0 := evs[0]; e0["action"] != "batch.created" {
		t.Errorf("batch timeline should be oldest first, got %v", e0["action"])
	}

	// order=desc pages through the same events, newest first.
	desc := collect("/api/v1/audit?order=desc&objectType=batch&objectId=" + id)
	if len(desc) != len(evs) {
		t.Fatalf("desc timeline has %d events, want %d", len(desc), len(evs))
	}
	for i := range evs {
		if desc[i]["id"] != evs[len(evs)-1-i]["id"] {
			t.Fatalf("desc event %d is not the reverse of asc", i)
		}
	}
	w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/audit?order=sideways&objectType=batch&objectId=" + id, skipRequestValidation: true}).expect(400, "invalid_request")

	w.do(t, call{token: w.mem, method: "GET", path: w.path("/teams/{}/audit", w.teamID)}).expect(403, "forbidden")
	w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}/audit", w.teamID) + "?limit=2"}).expect(200)
	w.do(t, call{token: w.adm, method: "GET", path: w.path("/teams/{}/audit", w.teamID) + "?limit=x", skipRequestValidation: true}).expect(400, "invalid_request")
}

// A batch holds at most MaxItemsPerBatch non-withdrawn items.
func TestHTTPBatchItemLimit(t *testing.T) {
	w := setup(t)
	old := service.MaxItemsPerBatch
	service.MaxItemsPerBatch = 2
	defer func() { service.MaxItemsPerBatch = old }()

	id, _ := w.openBatch(t, "Capped")
	bp := w.path("/batches/{}", id)
	a := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("a")}).expect(201)
	w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("b")}).expect(201)
	w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("c")}).expect(422, "batch_item_limit")
	// Withdrawn items do not count.
	w.do(t, call{token: w.mem, method: "POST", path: w.path("/items/{}", a.String("id")) + "/withdraw", ifMatch: a.ETag()}).expect(200)
	w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("c")}).expect(201)
}

func TestHTTPDeleteItem(t *testing.T) {
	w := setup(t)
	id, _ := w.openBatch(t, "Delete round")
	bp := w.path("/batches/{}", id)
	it := w.do(t, call{token: w.mem, method: "POST", path: bp + "/items", body: itemBody("gone")}).expect(201)
	ip := w.path("/items/{}", it.String("id"))
	w.do(t, call{token: w.mem, method: "DELETE", path: ip, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.mem, method: "DELETE", path: ip, ifMatch: it.ETag()}).expect(204)
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: bp + "/items"}).expect(200).Items()); n != 0 {
		t.Fatalf("items after delete = %d", n)
	}
}
