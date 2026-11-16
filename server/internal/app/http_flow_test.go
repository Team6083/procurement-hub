package app

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// world is a team with a system admin, a team admin, an approver and a member,
// all created through the HTTP API.
type world struct {
	*env
	root, adm, appr, mem, outsider string // bearer tokens
	admID, apprID, memID           string // user ids
	teamID                         string
}

func setup(t *testing.T) *world {
	t.Helper()
	return setupWith(t, nil)
}

// setupWith is setup with extra or overridden environment variables.
func setupWith(t *testing.T, overrides map[string]string) *world {
	t.Helper()
	e := newEnvWith(t, overrides)
	w := &world{env: e}
	w.root = e.user(t, "root", true)
	w.adm = e.user(t, "adm", false)
	w.appr = e.user(t, "appr", false)
	w.mem = e.user(t, "mem", false)
	w.outsider = e.user(t, "outsider", false)

	id := func(tok string) string {
		return e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}).expect(200).String("id")
	}
	w.admID, w.apprID, w.memID = id(w.adm), id(w.appr), id(w.mem)
	id(w.root)
	id(w.outsider)

	team := e.do(t, call{token: w.root, method: "POST", path: "/api/v1/teams", body: map[string]any{
		"slug": "alpha", "name": "Alpha", "description": "first team", "firstAdminUserId": w.admID,
	}}).expect(201)
	w.teamID = team.String("id")
	for _, uid := range []string{w.apprID, w.memID} {
		e.do(t, call{token: w.adm, method: "POST", path: "/api/v1/teams/" + w.teamID + "/members",
			body: map[string]any{"userId": uid, "role": "member"}}).expect(201)
	}
	return w
}

func (w *world) path(format string, a ...string) string {
	s := "/api/v1" + format
	for _, x := range a {
		s = replaceFirst(s, "{}", x)
	}
	return s
}

func replaceFirst(s, old, new string) string {
	for i := 0; i+len(old) <= len(s); i++ {
		if s[i:i+len(old)] == old {
			return s[:i] + new + s[i+len(old):]
		}
	}
	return s
}

func itemBody(name string) map[string]any {
	return map[string]any{
		"name": name, "quantity": 2, "priority": 3, "purpose": "lab work",
		"estimatedUnitPrice": map[string]any{"amount": "10.50", "currency": "USD"},
	}
}

// ---- authentication through the real middleware chain ----

func TestHTTPAuthentication(t *testing.T) {
	e := newEnv(t)
	me := func(tok string) *result { return e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}) }

	e.do(t, call{method: "GET", path: "/api/v1/meta"}).expect(200) // public
	me("").expect(401, "unauthenticated")
	me(e.user(t, "ok", false)).expect(200)
	me(e.user(t, "admin", true)).expect(200)
	if !me(e.user(t, "admin", true)).JSON()["isSystemAdmin"].(bool) {
		t.Error("client role admin should be a system admin")
	}
	if me(e.user(t, "plain", false)).JSON()["isSystemAdmin"].(bool) {
		t.Error("plain user must not be a system admin")
	}

	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	// HS256 keyed with the IdP's public key: the classic algorithm-confusion attack.
	pubDER, _ := x509.MarshalPKIXPublicKey(&e.idp.key.PublicKey)
	bad := map[string]string{
		"id token (typ ID)":           e.idp.token(t, map[string]any{"sub": "x", "typ": "ID"}),
		"refresh token (typ Refresh)": e.idp.token(t, map[string]any{"sub": "x", "typ": "Refresh"}),
		"missing typ":                 e.idp.token(t, map[string]any{"sub": "x", "typ": nil}),
		"ES256 (not allowed)":         e.idp.tokenWithAlg(t, jose.ES256, ecKey, map[string]any{"sub": "x"}),
		"HS256 (not allowed)":         e.idp.tokenWithAlg(t, jose.HS256, pubDER, map[string]any{"sub": "x"}),
		"missing exp":                 e.idp.token(t, map[string]any{"sub": "x", "exp": nil}),
		"signed by an unknown key":    e.idp.tokenWithKey(t, other, map[string]any{"sub": "x"}),
		"wrong audience":              e.idp.token(t, map[string]any{"sub": "x", "aud": "someone-else"}),
		"wrong issuer":                e.idp.token(t, map[string]any{"sub": "x", "iss": "https://evil.example.com"}),
		"expired":                     e.idp.token(t, map[string]any{"sub": "x", "exp": time.Now().Add(-time.Hour).Unix()}),
		"not yet valid":               e.idp.token(t, map[string]any{"sub": "x", "nbf": time.Now().Add(time.Hour).Unix()}),
		"no subject":                  e.idp.token(t, map[string]any{"sub": ""}),
		"garbage":                     "not.a.jwt",
	}
	for name, tok := range bad {
		t.Run(name, func(t *testing.T) { me(tok).expect(401, "unauthenticated") })
	}

	// A token for client role "admin" of a *different* client must not grant admin.
	wrongClient := e.idp.token(t, map[string]any{"sub": "sneaky", "resource_access": map[string]any{
		"another-app": map[string]any{"roles": []string{"admin"}},
	}})
	if me(wrongClient).JSON()["isSystemAdmin"].(bool) {
		t.Error("admin role of another client granted system admin")
	}
}

// ALLOWED_ROLES (spec §7.3): checked after token validation and before the
// user is provisioned or role mappings are synced.
func TestHTTPAllowedRoles(t *testing.T) {
	t.Run("unset allows everyone", func(t *testing.T) {
		e := newEnv(t)
		e.do(t, call{token: e.user(t, "plain", false), method: "GET", path: "/api/v1/me"}).expect(200)
	})

	e := newEnvWith(t, map[string]string{"ALLOWED_ROLES": "staff," + testRoleClient + ":user"})
	me := func(tok string) *result { return e.do(t, call{token: tok, method: "GET", path: "/api/v1/me"}) }
	userCount := func(sub string) int64 {
		t.Helper()
		n, err := e.st.DB.Collection("users").CountDocuments(context.Background(), bson.D{{Key: "sub", Value: sub}})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	tok := func(sub string, extra map[string]any) string {
		claims := map[string]any{"sub": sub, "preferred_username": sub, "groups": []string{"/teams/alpha/members"}}
		for k, v := range extra {
			claims[k] = v
		}
		return e.idp.token(t, claims)
	}

	e.do(t, call{method: "GET", path: "/api/v1/meta"}).expect(200) // still public

	denied := map[string]string{
		"no roles": tok("sub-none", nil),
		"realm role named like the client role": tok("sub-realm-user", map[string]any{
			"realm_access": map[string]any{"roles": []string{"user"}}}),
		"client role on another client": tok("sub-other-client", map[string]any{
			"resource_access": map[string]any{"another-app": map[string]any{"roles": []string{"user"}}}}),
		"bare realm name given as a client role": tok("sub-client-staff", map[string]any{
			"resource_access": map[string]any{testRoleClient: map[string]any{"roles": []string{"staff"}}}}),
	}
	for name, token := range denied {
		t.Run("denied/"+name, func(t *testing.T) {
			me(token).expect(403, "missing_role")
			e.do(t, call{token: token, method: "GET", path: "/api/v1/teams"}).expect(403, "missing_role")
		})
	}
	for _, sub := range []string{"sub-none", "sub-realm-user", "sub-other-client", "sub-client-staff"} {
		if n := userCount(sub); n != 0 {
			t.Errorf("user %s was provisioned despite missing_role (%d records)", sub, n)
		}
	}
	if n, _ := e.st.DB.Collection("memberships").CountDocuments(context.Background(), bson.D{}); n != 0 {
		t.Errorf("memberships created for denied users: %d", n)
	}

	allowed := map[string]string{
		"sub-staff": tok("sub-staff", map[string]any{"realm_access": map[string]any{"roles": []string{"staff"}}}),
		"sub-client-user": tok("sub-client-user", map[string]any{
			"resource_access": map[string]any{testRoleClient: map[string]any{"roles": []string{"user"}}}}),
		"sub-root": e.user(t, "root", true), // system admin without any allowed role
	}
	for sub, token := range allowed {
		t.Run("allowed/"+sub, func(t *testing.T) {
			me(token).expect(200)
			if n := userCount(sub); n != 1 {
				t.Errorf("user %s not provisioned (%d records)", sub, n)
			}
		})
	}
	if !me(allowed["sub-root"]).JSON()["isSystemAdmin"].(bool) {
		t.Error("admin should be a system admin")
	}
}

// ---- teams, members, subgroups, rates, role mappings ----

func TestHTTPTeams(t *testing.T) {
	w := setup(t)
	team := w.path("/teams/{}", w.teamID)

	// Visibility of team details: members get everything, others a summary.
	full := w.do(t, call{token: w.adm, method: "GET", path: team}).expect(200)
	if full.JSON()["version"] == nil {
		t.Error("members must see the full team")
	}
	if sum := w.do(t, call{token: w.outsider, method: "GET", path: team}).expect(200); sum.JSON()["version"] != nil {
		t.Error("non-members must only get a summary")
	}
	if n := len(w.do(t, call{token: w.outsider, method: "GET", path: "/api/v1/teams"}).expect(200).Items()); n != 1 {
		t.Errorf("team list = %d", n)
	}

	// Creating teams: system admins only; slug conflicts are business errors.
	w.do(t, call{token: w.adm, method: "POST", path: "/api/v1/teams", body: map[string]any{
		"slug": "beta", "name": "Beta", "firstAdminUserId": w.admID}}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "POST", path: "/api/v1/teams", body: map[string]any{
		"slug": "alpha", "name": "Dup", "firstAdminUserId": w.admID}}).expect(422, "team_slug_taken")

	// PATCH is partial; If-Match is mandatory; stale versions conflict.
	w.do(t, call{token: w.adm, method: "PATCH", path: team, body: map[string]any{"name": "Alpha 2"}, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.adm, method: "PATCH", path: team, ifMatch: "abc", body: map[string]any{"name": "x"}, skipRequestValidation: true}).expect(400, "invalid_if_match")
	upd := w.do(t, call{token: w.adm, method: "PATCH", path: team, ifMatch: full.ETag(), body: map[string]any{"name": "Alpha 2"}}).expect(200)
	if upd.String("name") != "Alpha 2" || upd.String("description") != "first team" {
		t.Errorf("partial update changed other fields: %s", upd.Body)
	}
	w.do(t, call{token: w.adm, method: "PATCH", path: team, ifMatch: full.ETag(), body: map[string]any{"name": "Alpha 3"}}).expect(409, "version_conflict")
	w.do(t, call{token: w.mem, method: "PATCH", path: team, ifMatch: upd.ETag(), body: map[string]any{"name": "Hacked"}}).expect(403, "forbidden")

	// Archiving: system admin only, and not combined with other fields.
	w.do(t, call{token: w.adm, method: "PATCH", path: team, ifMatch: upd.ETag(), body: map[string]any{"archived": true}}).expect(403, "forbidden")
	w.do(t, call{token: w.root, method: "PATCH", path: team, ifMatch: upd.ETag(), body: map[string]any{"archived": true, "name": "x"}}).expect(400, "invalid_request")

	// Members: 201 on create, 200 on update, responses match the list shape.
	members := w.path("/teams/{}/members", w.teamID)
	list := w.do(t, call{token: w.adm, method: "GET", path: members}).expect(200)
	if len(list.Items()) != 3 {
		t.Fatalf("members = %d", len(list.Items()))
	}
	again := w.do(t, call{token: w.adm, method: "POST", path: members, body: map[string]any{"userId": w.memID, "role": "admin"}}).expect(200)
	if again.String("effectiveRole") != "admin" {
		t.Errorf("manual admin role not effective: %s", again.Body)
	}
	memPath := w.path("/teams/{}/members/{}", w.teamID, w.memID)
	w.do(t, call{token: w.adm, method: "PATCH", path: memPath, body: map[string]any{"manualRole": "member"}, skipRequestValidation: true}).expect(428, "if_match_required")
	back := w.do(t, call{token: w.adm, method: "PATCH", path: memPath, ifMatch: again.ETag(), body: map[string]any{"manualRole": "member"}}).expect(200)
	w.do(t, call{token: w.adm, method: "PATCH", path: memPath, ifMatch: again.ETag(), body: map[string]any{"manualRole": "admin"}}).expect(409, "version_conflict")
	// A manual-only member can be removed; SSO-managed ones cannot (covered in service tests).
	w.do(t, call{token: w.adm, method: "DELETE", path: memPath, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.adm, method: "DELETE", path: memPath, ifMatch: back.ETag()}).expect(204)
	w.do(t, call{token: w.mem, method: "GET", path: members}).expect(403, "forbidden") // no longer a member
	w.do(t, call{token: w.adm, method: "POST", path: members, body: map[string]any{"userId": w.memID, "role": "member"}}).expect(201)

	// Subgroups and reference rates.
	cur := w.do(t, call{token: w.adm, method: "GET", path: team}).expect(200)
	sg := w.do(t, call{token: w.adm, method: "POST", path: team + "/subgroups", ifMatch: cur.ETag(), body: map[string]any{"name": "Hardware"}}).expect(200)
	sgID := sg.JSON()["subgroups"].([]any)[0].(map[string]any)["id"].(string)
	sg = w.do(t, call{token: w.adm, method: "PATCH", path: team + "/subgroups/" + sgID, ifMatch: sg.ETag(), body: map[string]any{"active": false}}).expect(200)
	w.do(t, call{token: w.adm, method: "POST", path: team + "/subgroups", ifMatch: sg.ETag(), body: map[string]any{"name": "hardware"}}).expect(422, "subgroup_exists")

	// Global reference rates: system admins write, everyone reads, modification needs If-Match.
	w.do(t, call{token: w.adm, method: "PUT", path: "/api/v1/reference-rates/TWD", body: map[string]any{"rateToBase": "0.031"}}).expect(403, "forbidden")
	rate := w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/TWD", body: map[string]any{"rateToBase": "0.031"}}).expect(201)
	w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/TWD", body: map[string]any{"rateToBase": "0.032"}, skipRequestValidation: true}).expect(428, "if_match_required")
	rate = w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/TWD", ifMatch: rate.ETag(), body: map[string]any{"rateToBase": "0.032"}}).expect(200)
	if rate.String("rateToBase") != "0.032" {
		t.Errorf("rate: %s", rate.Body)
	}
	if n := len(w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/reference-rates"}).expect(200).Items()); n != 1 {
		t.Errorf("rates listed = %d", n)
	}
	for name, body := range map[string]map[string]any{
		"seven fractional digits": {"rateToBase": "0.1234567"},
		"zero":                    {"rateToBase": "0"},
		"negative":                {"rateToBase": "-1"},
	} {
		t.Run("rate "+name, func(t *testing.T) {
			w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/TWD", ifMatch: rate.ETag(), body: body}).expect(400, "invalid_request")
		})
	}
	w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/USD", body: map[string]any{"rateToBase": "1"}}).expect(400, "invalid_request")
	w.do(t, call{token: w.root, method: "PUT", path: "/api/v1/reference-rates/EUR", body: map[string]any{"rateToBase": "1"}}).expect(400, "invalid_request")
	w.do(t, call{token: w.root, method: "DELETE", path: "/api/v1/reference-rates/TWD", skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.root, method: "DELETE", path: "/api/v1/reference-rates/TWD", ifMatch: rate.ETag()}).expect(204)

	// User search.
	w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/users?q=ap"}).expect(200)
	w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/users?q=a", skipRequestValidation: true}).expect(400, "invalid_request")
	if n := len(w.do(t, call{token: w.adm, method: "GET", path: "/api/v1/users?q=ap"}).Items()); n != 1 {
		t.Errorf("search results = %d", n)
	}

	// /me: locale is null until chosen (spec §0); partial update with If-Match.
	me := w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/me"}).expect(200)
	if loc, ok := me.JSON()["locale"]; !ok || loc != nil {
		t.Errorf("new user locale = %v (present %v), want null", loc, ok)
	}
	w.do(t, call{token: w.mem, method: "PATCH", path: "/api/v1/me", body: map[string]any{"locale": "zh-TW"}, skipRequestValidation: true}).expect(428, "if_match_required")
	if got := w.do(t, call{token: w.mem, method: "PATCH", path: "/api/v1/me", ifMatch: me.ETag(), body: map[string]any{"locale": "zh-TW"}}).expect(200); got.String("locale") != "zh-TW" {
		t.Errorf("locale: %s", got.Body)
	}
	// Once chosen it is returned as-is, and an unrelated PATCH keeps it.
	me = w.do(t, call{token: w.mem, method: "GET", path: "/api/v1/me"}).expect(200)
	if me.String("locale") != "zh-TW" {
		t.Errorf("GET /me locale after PATCH: %s", me.Body)
	}
	got := w.do(t, call{token: w.mem, method: "PATCH", path: "/api/v1/me", ifMatch: me.ETag(),
		body: map[string]any{"notificationPrefs": map[string]any{}}}).expect(200)
	if got.String("locale") != "zh-TW" {
		t.Errorf("locale after notificationPrefs PATCH: %s", got.Body)
	}
	w.do(t, call{token: w.mem, method: "PATCH", path: "/api/v1/me", ifMatch: got.ETag(), body: map[string]any{"locale": "fr"},
		skipRequestValidation: true}).expect(400, "invalid_request")
}

func TestHTTPRoleMappings(t *testing.T) {
	w := setup(t)
	base := "/api/v1/admin/role-mappings"
	rule := map[string]any{"claim": "groups", "pattern": "/teams/*/members", "team": "$1", "role": "member", "enabled": true, "description": "all members"}

	w.do(t, call{token: w.adm, method: "GET", path: base}).expect(403, "forbidden")
	w.do(t, call{token: w.adm, method: "POST", path: base, body: rule}).expect(403, "forbidden")
	created := w.do(t, call{token: w.root, method: "POST", path: base, body: rule}).expect(201)
	id := created.String("id")
	if v, _ := created.JSON()["version"].(float64); v != 1 {
		t.Errorf("new rule version = %v", v)
	}
	w.do(t, call{token: w.root, method: "POST", path: base, body: map[string]any{
		"claim": "groups", "pattern": "/a*b", "team": "x", "role": "member", "enabled": true, "description": ""}}).expect(400, "invalid_request")

	// PUT replaces everything (omitted description is cleared) and needs If-Match.
	path := base + "/" + id
	put := map[string]any{"claim": "groups", "pattern": "/teams/*/admins", "team": "$1", "role": "admin", "enabled": false}
	w.do(t, call{token: w.root, method: "PUT", path: path, body: put, skipRequestValidation: true}).expect(428, "if_match_required")
	upd := w.do(t, call{token: w.root, method: "PUT", path: path, ifMatch: created.ETag(), body: put}).expect(200)
	if upd.String("description") != "" || upd.JSON()["enabled"] != false || upd.String("role") != "admin" {
		t.Errorf("PUT did not fully replace: %s", upd.Body)
	}
	w.do(t, call{token: w.root, method: "PUT", path: path, ifMatch: created.ETag(), body: put}).expect(409, "version_conflict")
	if n := len(w.do(t, call{token: w.root, method: "GET", path: base}).expect(200).Items()); n != 1 {
		t.Errorf("rules = %d", n)
	}
	w.do(t, call{token: w.root, method: "DELETE", path: path, skipRequestValidation: true}).expect(428, "if_match_required")
	w.do(t, call{token: w.root, method: "DELETE", path: path, ifMatch: created.ETag()}).expect(409, "version_conflict")
	w.do(t, call{token: w.root, method: "DELETE", path: path, ifMatch: upd.ETag()}).expect(204)
	w.do(t, call{token: w.root, method: "DELETE", path: path, ifMatch: upd.ETag()}).expect(404, "not_found")

	// Managed rules (from ROLE_MAPPINGS_FILE) are read-only and versioned by content.
	if err := w.st.SyncManagedRoleMappings(t.Context(), mustParse(t, "rules:\n  - {id: file-rule, claim: groups, pattern: /ops, team: ops, role: member}\n")); err != nil {
		t.Fatal(err)
	}
	managed := w.do(t, call{token: w.root, method: "GET", path: base}).expect(200).Items()
	if len(managed) != 1 || managed[0].(map[string]any)["managed"] != true {
		t.Fatalf("managed rule missing: %v", managed)
	}
	w.do(t, call{token: w.root, method: "PUT", path: base + "/file-rule", ifMatch: `"1"`, body: put}).expect(422, "role_mapping_managed")
	w.do(t, call{token: w.root, method: "DELETE", path: base + "/file-rule", ifMatch: `"1"`}).expect(422, "role_mapping_managed")
}

func mustParse(t *testing.T, doc string) []domain.RoleMapping {
	t.Helper()
	rules, err := service.ParseRuleFile([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	return rules
}
