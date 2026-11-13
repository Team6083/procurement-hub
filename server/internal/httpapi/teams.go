package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// TeamsAPI serves team, member, subgroup and reference-rate endpoints.
type TeamsAPI struct{ Teams *service.Teams }

func (a *TeamsAPI) Mount(r chi.Router) {
	r.Get("/teams", a.list)
	r.Post("/teams", a.create)
	r.Get("/teams/{teamId}", a.get)
	r.Patch("/teams/{teamId}", a.patch)
	r.Get("/teams/{teamId}/members", a.listMembers)
	r.Post("/teams/{teamId}/members", a.addMember)
	r.Patch("/teams/{teamId}/members/{userId}", a.patchMember)
	r.Delete("/teams/{teamId}/members/{userId}", a.removeMember)
	r.Post("/teams/{teamId}/subgroups", a.addSubgroup)
	r.Patch("/teams/{teamId}/subgroups/{id}", a.patchSubgroup)
	r.Put("/teams/{teamId}/reference-rates", a.putRates)
}

// teamSummary is what non-members may see (names are public, spec §8.2).
type teamSummary struct {
	ID          bson.ObjectID `json:"id"`
	Slug        string        `json:"slug"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Archived    bool          `json:"archived"`
}

func summary(t domain.Team) teamSummary {
	return teamSummary{ID: t.ID, Slug: t.Slug, Name: t.Name, Description: t.Description, Archived: t.Archived}
}

func (a *TeamsAPI) teamParam(w http.ResponseWriter, r *http.Request) (bson.ObjectID, bool) {
	id, e := objectID(chi.URLParam(r, "teamId"))
	if e != nil {
		WriteError(w, e)
		return id, false
	}
	return id, true
}

func (a *TeamsAPI) list(w http.ResponseWriter, r *http.Request) {
	ts, err := a.Teams.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]teamSummary, 0, len(ts))
	for _, t := range ts {
		out = append(out, summary(t))
	}
	WriteJSON(w, http.StatusOK, wholeList(out))
}

type createTeamReq struct {
	Slug             string `json:"slug"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	FirstAdminUserID string `json:"firstAdminUserId"`
}

func (a *TeamsAPI) create(w http.ResponseWriter, r *http.Request) {
	var req createTeamReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	adminID, e := bson.ObjectIDFromHex(req.FirstAdminUserID)
	if e != nil {
		fail(w, service.Invalid("firstAdminUserId", "must be a user id"))
		return
	}
	t, err := a.Teams.Create(r.Context(), CallerFrom(r.Context()).Actor, service.CreateTeamInput{
		Slug: req.Slug, Name: req.Name, Description: req.Description, FirstAdminID: adminID,
	})
	if err != nil {
		fail(w, err)
		return
	}
	setETag(w, t.Version)
	WriteJSON(w, http.StatusCreated, t)
}

// get returns full details to members/system admins, a summary to others.
func (a *TeamsAPI) get(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	t, err := a.Teams.GetByID(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	if !CallerFrom(r.Context()).Actor.CanSeeTeamInternals(t.ID) {
		WriteJSON(w, http.StatusOK, summary(*t))
		return
	}
	setETag(w, t.Version)
	WriteJSON(w, http.StatusOK, t)
}

type patchTeamReq struct {
	Name           *string            `json:"name"`
	Description    *string            `json:"description"`
	Visibility     *domain.Visibility `json:"visibility"`
	Locale         *domain.Locale     `json:"locale"`
	PriorityLabels *map[string]string `json:"priorityLabels"`
	Archived       *bool              `json:"archived"`
}

func (a *TeamsAPI) patch(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req patchTeamReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	actor := CallerFrom(r.Context()).Actor
	var t *domain.Team
	var err error
	if req.Archived != nil {
		// Archive state is a system-admin action and cannot be mixed with other edits.
		if req.Name != nil || req.Description != nil || req.Visibility != nil || req.Locale != nil || req.PriorityLabels != nil {
			fail(w, service.Invalid("archived", "cannot be combined with other fields"))
			return
		}
		t, err = a.Teams.SetArchived(r.Context(), actor, id, ver, *req.Archived)
	} else {
		t, err = a.Teams.Update(r.Context(), actor, id, ver, service.TeamPatch{
			Name: req.Name, Description: req.Description, Visibility: req.Visibility,
			Locale: req.Locale, PriorityLabels: req.PriorityLabels,
		})
	}
	a.respondTeam(w, t, err)
}

func (a *TeamsAPI) respondTeam(w http.ResponseWriter, t *domain.Team, err error) {
	if err != nil {
		fail(w, err)
		return
	}
	setETag(w, t.Version)
	WriteJSON(w, http.StatusOK, t)
}

type memberResp struct {
	UserID            bson.ObjectID `json:"userId"`
	Username          string        `json:"username"`
	DisplayName       string        `json:"displayName"`
	Email             string        `json:"email"`
	SSORole           domain.Role   `json:"ssoRole"`
	ManualRole        domain.Role   `json:"manualRole"`
	EffectiveRole     domain.Role   `json:"effectiveRole"`
	DefaultSubgroupID string        `json:"defaultSubgroupId"`
	Version           int64         `json:"version"`
}

func toMemberResp(m service.MemberView) memberResp {
	return memberResp{
		UserID: m.User.ID, Username: m.User.Username, DisplayName: m.User.DisplayName, Email: m.User.Email,
		SSORole: m.Membership.SSORole, ManualRole: m.Membership.ManualRole, EffectiveRole: m.Effective,
		DefaultSubgroupID: m.Membership.DefaultSubgroupID, Version: m.Membership.Version,
	}
}

func (a *TeamsAPI) respondMember(w http.ResponseWriter, r *http.Request, status int, teamID, userID bson.ObjectID) {
	mv, err := a.Teams.GetMemberView(r.Context(), teamID, userID)
	if err != nil {
		fail(w, err)
		return
	}
	setETag(w, mv.Membership.Version)
	WriteJSON(w, status, toMemberResp(*mv))
}

func (a *TeamsAPI) listMembers(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	ms, err := a.Teams.ListMembers(r.Context(), CallerFrom(r.Context()).Actor, id)
	if err != nil {
		fail(w, err)
		return
	}
	out := make([]memberResp, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMemberResp(m))
	}
	WriteJSON(w, http.StatusOK, wholeList(out))
}

type addMemberReq struct {
	UserID string      `json:"userId"`
	Role   domain.Role `json:"role"`
}

func (a *TeamsAPI) addMember(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	var req addMemberReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	uid, err := bson.ObjectIDFromHex(req.UserID)
	if err != nil {
		fail(w, service.Invalid("userId", "must be a user id"))
		return
	}
	_, created, err := a.Teams.AddMember(r.Context(), CallerFrom(r.Context()).Actor, id, uid, req.Role)
	if err != nil {
		fail(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	a.respondMember(w, r, status, id, uid)
}

type patchMemberReq struct {
	// ManualRole: "member" | "admin" sets it; JSON null clears it.
	ManualRole        optionalRole `json:"manualRole"`
	DefaultSubgroupID *string      `json:"defaultSubgroupId"`
}

func (a *TeamsAPI) patchMember(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	uid, e := objectID(chi.URLParam(r, "userId"))
	if e != nil {
		WriteError(w, e)
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req patchMemberReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	p := service.MemberPatch{DefaultSubgroup: req.DefaultSubgroupID}
	if req.ManualRole.Set {
		if req.ManualRole.Null {
			p.ClearManualRole = true
		} else {
			role := req.ManualRole.Role
			p.ManualRole = &role
		}
	}
	if _, err := a.Teams.UpdateMember(r.Context(), CallerFrom(r.Context()).Actor, id, uid, ver, p); err != nil {
		fail(w, err)
		return
	}
	a.respondMember(w, r, http.StatusOK, id, uid)
}

func (a *TeamsAPI) removeMember(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	uid, e := objectID(chi.URLParam(r, "userId"))
	if e != nil {
		WriteError(w, e)
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	if err := a.Teams.RemoveMember(r.Context(), CallerFrom(r.Context()).Actor, id, uid, ver); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *TeamsAPI) addSubgroup(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	t, err := a.Teams.AddSubgroup(r.Context(), CallerFrom(r.Context()).Actor, id, ver, req.Name)
	a.respondTeam(w, t, err)
}

func (a *TeamsAPI) patchSubgroup(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Name   *string `json:"name"`
		Active *bool   `json:"active"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	t, err := a.Teams.UpdateSubgroup(r.Context(), CallerFrom(r.Context()).Actor, id, ver, chi.URLParam(r, "id"), req.Name, req.Active)
	a.respondTeam(w, t, err)
}

func (a *TeamsAPI) putRates(w http.ResponseWriter, r *http.Request) {
	id, ok := a.teamParam(w, r)
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Rates []struct {
			Currency   string `json:"currency"`
			RateToBase string `json:"rateToBase"`
		} `json:"rates"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := make([]service.RateInput, 0, len(req.Rates))
	for _, x := range req.Rates {
		in = append(in, service.RateInput{Currency: x.Currency, RateToBase: x.RateToBase})
	}
	t, err := a.Teams.ReplaceReferenceRates(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	a.respondTeam(w, t, err)
}
