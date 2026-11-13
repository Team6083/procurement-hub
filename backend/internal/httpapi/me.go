package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/service"
)

// MeAPI serves /me, /users and /admin/role-mappings.
type MeAPI struct {
	Users        *service.Users
	RoleMappings *service.RoleMappings
}

func (a *MeAPI) Mount(r chi.Router) {
	r.Get("/me", a.me)
	r.Patch("/me", a.patchMe)
	r.Get("/users", a.users)
	r.Get("/admin/role-mappings", a.listRules)
	r.Post("/admin/role-mappings", a.createRule)
	r.Put("/admin/role-mappings/{id}", a.putRule)
	r.Delete("/admin/role-mappings/{id}", a.deleteRule)
}

type membershipResp struct {
	TeamID            bson.ObjectID `json:"teamId"`
	Slug              string        `json:"slug"`
	Name              string        `json:"name"`
	Role              domain.Role   `json:"role"`
	SSORole           domain.Role   `json:"ssoRole"`
	ManualRole        domain.Role   `json:"manualRole"`
	DefaultSubgroupID string        `json:"defaultSubgroupId"`
}

type meResp struct {
	*domain.User
	Memberships   []membershipResp `json:"memberships"`
	IsSystemAdmin bool             `json:"isSystemAdmin"`
}

func (a *MeAPI) respondMe(w http.ResponseWriter, r *http.Request, status int, u *domain.User) {
	c := CallerFrom(r.Context())
	ms, err := a.Users.Memberships(r.Context(), u.ID)
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]membershipResp, 0, len(ms))
	for _, m := range ms {
		out = append(out, membershipResp(m))
	}
	setETag(w, u.Version)
	WriteJSON(w, status, meResp{User: u, Memberships: out, IsSystemAdmin: c.Actor.IsSystemAdmin})
}

func (a *MeAPI) me(w http.ResponseWriter, r *http.Request) {
	a.respondMe(w, r, http.StatusOK, CallerFrom(r.Context()).User)
}

func (a *MeAPI) patchMe(w http.ResponseWriter, r *http.Request) {
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Locale            *domain.Locale                      `json:"locale"`
		NotificationPrefs *map[string]domain.NotificationPref `json:"notificationPrefs"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	u, err := a.Users.UpdateProfile(r.Context(), CallerFrom(r.Context()).User.ID, ver,
		service.ProfilePatch{Locale: req.Locale, NotificationPrefs: req.NotificationPrefs})
	if err != nil {
		fail(w, err)
		return
	}
	a.respondMe(w, r, http.StatusOK, u)
}

type userResp struct {
	ID          bson.ObjectID `json:"id"`
	Username    string        `json:"username"`
	DisplayName string        `json:"displayName"`
	Email       string        `json:"email"`
}

func (a *MeAPI) users(w http.ResponseWriter, r *http.Request) {
	us, err := a.Users.Search(r.Context(), CallerFrom(r.Context()).Actor, r.URL.Query().Get("q"))
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]userResp, 0, len(us))
	for _, u := range us {
		out = append(out, userResp{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Email: u.Email})
	}
	WriteJSON(w, http.StatusOK, wholeList(out))
}

func (a *MeAPI) listRules(w http.ResponseWriter, r *http.Request) {
	rs, err := a.RoleMappings.List(r.Context(), CallerFrom(r.Context()).Actor)
	if err != nil {
		fail(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(rs))
}

type ruleReq struct {
	Claim       domain.Claim `json:"claim"`
	Pattern     string       `json:"pattern"`
	Team        string       `json:"team"`
	Role        domain.Role  `json:"role"`
	Enabled     bool         `json:"enabled"`
	Description string       `json:"description"`
}

func (a *MeAPI) createRule(w http.ResponseWriter, r *http.Request) {
	var req ruleReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	m, err := a.RoleMappings.Create(r.Context(), CallerFrom(r.Context()).Actor, req.mapping())
	if err != nil {
		fail(w, err)
		return
	}
	setETag(w, m.Version)
	WriteJSON(w, http.StatusCreated, m)
}

func (r ruleReq) mapping() domain.RoleMapping {
	return domain.RoleMapping{Claim: r.Claim, Pattern: r.Pattern, Team: r.Team, Role: r.Role, Enabled: r.Enabled, Description: r.Description}
}

// putRule replaces all editable fields (omitted fields are cleared, spec §16.1).
func (a *MeAPI) putRule(w http.ResponseWriter, r *http.Request) {
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req ruleReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	m, err := a.RoleMappings.Replace(r.Context(), CallerFrom(r.Context()).Actor, chi.URLParam(r, "id"), ver, req.mapping())
	if err != nil {
		fail(w, err)
		return
	}
	setETag(w, m.Version)
	WriteJSON(w, http.StatusOK, m)
}

func (a *MeAPI) deleteRule(w http.ResponseWriter, r *http.Request) {
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	if err := a.RoleMappings.Delete(r.Context(), CallerFrom(r.Context()).Actor, chi.URLParam(r, "id"), ver); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
