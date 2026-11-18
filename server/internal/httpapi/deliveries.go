package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// DeliveriesAPI serves receiving: deliveries, delivery lines, matches, problems.
type DeliveriesAPI struct{ Deliveries *service.Deliveries }

func (a *DeliveriesAPI) Mount(r chi.Router) {
	r.Get("/deliveries", a.list)
	r.Post("/deliveries", a.create)
	r.Get("/deliveries/{id}", a.get)
	r.Post("/deliveries/{id}/void", a.void)
	r.Get("/delivery-lines", a.lines)
	r.Get("/delivery-lines/{id}/suggestions", a.suggestions)
	r.Put("/delivery-lines/{id}/matches", a.setMatches)
	r.Post("/delivery-lines/{id}/no-match", a.noMatch)
	r.Post("/delivery-lines/{id}/no-match/undo", a.undoNoMatch)
	r.Get("/purchasing/match-candidates", a.matchCandidates)
	r.Get("/problems", a.problems)
	r.Post("/problems/{id}/resolve", a.resolve)
	r.Post("/problems/{id}/unresolve", a.unresolve)
}

func respondDelivery(w http.ResponseWriter, r *http.Request, status int, d *service.DeliveryDetail, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, d.Version)
	WriteJSON(w, status, d)
}

func respondProblem(w http.ResponseWriter, r *http.Request, p *service.ProblemView, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, p.Version)
	WriteJSON(w, http.StatusOK, p)
}

func (a *DeliveriesAPI) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, e := parseLimit(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	cursor, err := parseCursor(r)
	if err != nil {
		fail(w, r, err)
		return
	}
	in := service.ListDeliveriesInput{From: q.Get("from"), To: q.Get("to"), Query: q.Get("q"), Cursor: cursor, Limit: limit}
	switch q.Get("voided") {
	case "":
	case "true", "false":
		v := q.Get("voided") == "true"
		in.Voided = &v
	default:
		fail(w, r, service.Invalid("voided", "must be true or false"))
		return
	}
	p, err := a.Deliveries.List(r.Context(), CallerFrom(r.Context()).Actor, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, newPage(p.Items, p.NextCursor))
}

type matchReq struct {
	VendorOrderLineID string `json:"vendorOrderLineId"`
	GoodQuantity      int    `json:"goodQuantity"`
	ProblemQuantity   int    `json:"problemQuantity"`
}

func toMatches(reqs []matchReq) ([]service.MatchInput, error) {
	out := make([]service.MatchInput, 0, len(reqs))
	for _, m := range reqs {
		id, err := bson.ObjectIDFromHex(m.VendorOrderLineID)
		if err != nil {
			return nil, service.Invalid("matches", "vendorOrderLineId must be an id")
		}
		out = append(out, service.MatchInput{VendorOrderLineID: id, GoodQuantity: m.GoodQuantity, ProblemQuantity: m.ProblemQuantity})
	}
	return out, nil
}

func (a *DeliveriesAPI) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ReceivedAt string `json:"receivedAt"`
		Source     string `json:"source"`
		Note       string `json:"note"`
		Lines      []struct {
			Name            string     `json:"name"`
			SKU             string     `json:"sku"`
			GoodQuantity    int        `json:"goodQuantity"`
			ProblemQuantity int        `json:"problemQuantity"`
			ProblemType     string     `json:"problemType"`
			ProblemNote     string     `json:"problemNote"`
			Matches         []matchReq `json:"matches"`
		} `json:"lines"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.CreateDeliveryInput{ReceivedAt: req.ReceivedAt, Source: req.Source, Note: req.Note}
	for _, l := range req.Lines {
		ms, err := toMatches(l.Matches)
		if err != nil {
			fail(w, r, err)
			return
		}
		in.Lines = append(in.Lines, service.DeliveryLineInput{Name: l.Name, SKU: l.SKU, GoodQuantity: l.GoodQuantity,
			ProblemQuantity: l.ProblemQuantity, ProblemType: l.ProblemType, ProblemNote: l.ProblemNote, Matches: ms})
	}
	d, err := a.Deliveries.Create(r.Context(), CallerFrom(r.Context()).Actor, in)
	respondDelivery(w, r, http.StatusCreated, d, err)
}

func (a *DeliveriesAPI) get(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	d, err := a.Deliveries.Get(r.Context(), CallerFrom(r.Context()).Actor, id)
	respondDelivery(w, r, http.StatusOK, d, err)
}

// reasonVersioned parses the id, If-Match and a {reason} body.
func reasonVersioned(w http.ResponseWriter, r *http.Request) (id bson.ObjectID, ver int64, reason string, ok bool) {
	id, ok = idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return id, 0, "", false
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return id, 0, "", false
	}
	return id, ver, req.Reason, true
}

func (a *DeliveriesAPI) void(w http.ResponseWriter, r *http.Request) {
	id, ver, reason, ok := reasonVersioned(w, r)
	if !ok {
		return
	}
	d, err := a.Deliveries.Void(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	respondDelivery(w, r, http.StatusOK, d, err)
}

func (a *DeliveriesAPI) lines(w http.ResponseWriter, r *http.Request) {
	var states []domain.MatchState
	if v := r.URL.Query().Get("matchState"); v != "" {
		for _, s := range strings.Split(v, ",") {
			switch st := domain.MatchState(strings.TrimSpace(s)); st {
			case domain.MatchUnmatched, domain.MatchPartial, domain.MatchMatched, domain.MatchNotNeeded:
				states = append(states, st)
			default:
				fail(w, r, service.Invalid("matchState", "must be a comma list of unmatched, partial, matched, not_needed"))
				return
			}
		}
	}
	ls, err := a.Deliveries.Lines(r.Context(), CallerFrom(r.Context()).Actor, states)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(ls))
}

func (a *DeliveriesAPI) suggestions(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	cs, err := a.Deliveries.Suggestions(r.Context(), CallerFrom(r.Context()).Actor, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(cs))
}

func (a *DeliveriesAPI) matchCandidates(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cs, err := a.Deliveries.MatchCandidates(r.Context(), CallerFrom(r.Context()).Actor, q.Get("sku"), q.Get("name"))
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(cs))
}

func (a *DeliveriesAPI) setMatches(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Matches []matchReq `json:"matches"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	ms, err := toMatches(req.Matches)
	if err != nil {
		fail(w, r, err)
		return
	}
	d, err := a.Deliveries.SetMatches(r.Context(), CallerFrom(r.Context()).Actor, id, ver, ms)
	respondDelivery(w, r, http.StatusOK, d, err)
}

func (a *DeliveriesAPI) noMatch(w http.ResponseWriter, r *http.Request) {
	id, ver, reason, ok := reasonVersioned(w, r)
	if !ok {
		return
	}
	d, err := a.Deliveries.NoMatch(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	respondDelivery(w, r, http.StatusOK, d, err)
}

func (a *DeliveriesAPI) undoNoMatch(w http.ResponseWriter, r *http.Request) {
	id, ver, reason, ok := reasonVersioned(w, r)
	if !ok {
		return
	}
	d, err := a.Deliveries.UndoNoMatch(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	respondDelivery(w, r, http.StatusOK, d, err)
}

func (a *DeliveriesAPI) problems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	oid, err := queryID(r, "vendorOrderId")
	if err != nil {
		fail(w, r, err)
		return
	}
	ps, err := a.Deliveries.Problems(r.Context(), CallerFrom(r.Context()).Actor, q.Get("status"), oid)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(ps))
}

func (a *DeliveriesAPI) resolve(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req struct {
		Action string     `json:"action"`
		Refund *refundReq `json:"refund"`
		Note   string     `json:"note"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.ResolveInput{Action: req.Action, Note: req.Note, Refund: req.Refund.input()}
	p, err := a.Deliveries.Resolve(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	respondProblem(w, r, p, err)
}

func (a *DeliveriesAPI) unresolve(w http.ResponseWriter, r *http.Request) {
	id, ver, reason, ok := reasonVersioned(w, r)
	if !ok {
		return
	}
	p, err := a.Deliveries.Unresolve(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	respondProblem(w, r, p, err)
}
