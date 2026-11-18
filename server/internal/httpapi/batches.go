package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// BatchesAPI serves batches, items, reviews, tasks and audit timelines.
type BatchesAPI struct {
	Batches  *service.Batches
	Items    *service.Items
	Tasks    *service.Tasks
	Timeline *service.Timeline
}

func (a *BatchesAPI) Mount(r chi.Router) {
	r.Get("/batches", a.list)
	r.Post("/teams/{teamId}/batches", a.create)
	r.Get("/batches/{id}", a.get)
	r.Patch("/batches/{id}", a.patch)
	r.Put("/batches/{id}/assignments", a.assignments)
	r.Post("/batches/{id}/transitions", a.transition)
	r.Get("/batches/{id}/items", a.listItems)
	r.Post("/batches/{id}/items", a.addItem)
	r.Post("/batches/{id}/reviews", a.review)
	r.Put("/items/{id}", a.putItem)
	r.Post("/items/{id}/withdraw", a.withdrawItem)
	r.Delete("/items/{id}", a.deleteItem)
	r.Post("/items/{id}/resubmit", a.resubmitItem)
	r.Post("/items/{id}/force-reject", a.forceReject)
	r.Post("/items/{id}/unpurchasable", a.unpurchasable)
	r.Post("/items/{id}/unpurchasable/undo", a.undoUnpurchasable)
	r.Post("/items/{id}/review/undo", a.undoReview)
	r.Post("/items/{id}/copy", a.copyItem)
	r.Get("/me/tasks", a.tasks)
	r.Get("/audit", a.audit)
	r.Get("/teams/{teamId}/audit", a.teamAudit)
}

func idParam(w http.ResponseWriter, r *http.Request, name string) (bson.ObjectID, bool) {
	id, e := objectID(chi.URLParam(r, name))
	if e != nil {
		WriteError(w, e)
		return id, false
	}
	return id, true
}

func (a *BatchesAPI) actor(r *http.Request) *Caller { return CallerFrom(r.Context()) }

func respondBatch(w http.ResponseWriter, r *http.Request, status int, b *domain.Batch, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, b.Version)
	WriteJSON(w, status, b)
}

func (a *BatchesAPI) list(w http.ResponseWriter, r *http.Request) {
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
	in := service.ListBatchesInput{Status: domain.BatchStatus(q.Get("status")), Query: q.Get("q"), Cursor: cursor, Limit: limit}
	if v := q.Get("teamId"); v != "" {
		id, e := bson.ObjectIDFromHex(v)
		if e != nil {
			fail(w, r, service.Invalid("teamId", "must be a team id"))
			return
		}
		in.TeamID = id
	}
	p, err := a.Batches.List(r.Context(), a.actor(r).Actor, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, newPage(p.Items, p.NextCursor))
}

func (a *BatchesAPI) create(w http.ResponseWriter, r *http.Request) {
	teamID, ok := idParam(w, r, "teamId")
	if !ok {
		return
	}
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Propose     bool   `json:"propose"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	b, err := a.Batches.Create(r.Context(), a.actor(r).Actor, teamID, service.CreateBatchInput{
		Title: req.Title, Description: req.Description, Propose: req.Propose,
	})
	respondBatch(w, r, http.StatusCreated, b, err)
}

func (a *BatchesAPI) get(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	b, _, err := a.Batches.Get(r.Context(), a.actor(r).Actor, id)
	respondBatch(w, r, http.StatusOK, b, err)
}

func (a *BatchesAPI) patch(w http.ResponseWriter, r *http.Request) {
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
		Title              *string        `json:"title"`
		Description        *string        `json:"description"`
		Deadline           optionalTime   `json:"deadline"`
		VisibilityOverride optionalString `json:"visibilityOverride"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	b, err := a.Batches.Update(r.Context(), a.actor(r).Actor, id, ver, service.BatchPatch{
		Title: req.Title, Description: req.Description,
		DeadlineSet: req.Deadline.Set, Deadline: req.Deadline.Value,
		VisibilitySet: req.VisibilityOverride.Set, VisibilityOverride: domain.Visibility(req.VisibilityOverride.Value),
	})
	respondBatch(w, r, http.StatusOK, b, err)
}

func (a *BatchesAPI) assignments(w http.ResponseWriter, r *http.Request) {
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
		Approvers  []string `json:"approvers"`
		Purchasers []string `json:"purchasers"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	parse := func(field string, in []string) ([]bson.ObjectID, error) {
		out := make([]bson.ObjectID, 0, len(in))
		for _, s := range in {
			oid, err := bson.ObjectIDFromHex(s)
			if err != nil {
				return nil, service.Invalid(field, "invalid user id")
			}
			out = append(out, oid)
		}
		return out, nil
	}
	var in service.AssignmentsInput
	var err error
	if in.Approvers, err = parse("approvers", req.Approvers); err != nil {
		fail(w, r, err)
		return
	}
	if in.Purchasers, err = parse("purchasers", req.Purchasers); err != nil {
		fail(w, r, err)
		return
	}
	b, err := a.Batches.SetAssignments(r.Context(), a.actor(r).Actor, id, ver, in)
	respondBatch(w, r, http.StatusOK, b, err)
}

func (a *BatchesAPI) transition(w http.ResponseWriter, r *http.Request) {
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
		Action   domain.BatchAction `json:"action"`
		Reason   string             `json:"reason"`
		Deadline *time.Time         `json:"deadline"`
		// PurchaseOutside applies to confirm_review only.
		PurchaseOutside bool `json:"purchaseOutside"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	if req.Deadline != nil {
		d := req.Deadline.UTC()
		req.Deadline = &d
	}
	b, err := a.Batches.Transition(r.Context(), a.actor(r).Actor, id, ver, service.TransitionInput{
		Action: req.Action, Reason: req.Reason, Deadline: req.Deadline, PurchaseOutside: req.PurchaseOutside,
	})
	respondBatch(w, r, http.StatusOK, b, err)
}

// ---- items ----

type itemReq struct {
	SubgroupID         string       `json:"subgroupId"`
	Name               string       `json:"name"`
	VendorID           *string      `json:"vendorId"`
	VendorName         string       `json:"vendorName"`
	SKU                string       `json:"sku"`
	Quantity           int          `json:"quantity"`
	EstimatedUnitPrice domain.Money `json:"estimatedUnitPrice"`
	Priority           int          `json:"priority"`
	Purpose            string       `json:"purpose"`
	Notes              string       `json:"notes"`
	ProductURL         string       `json:"productUrl"`
	AutoFilledFields   []string     `json:"autoFilledFields"`
	LookupProvider     string       `json:"lookupProvider"`
	RelatedItemID      *string      `json:"relatedItemId"`
}

// vendorOID parses vendorId; a malformed id becomes a zero id that fails vendor lookup.
func (q itemReq) vendorOID() *bson.ObjectID {
	if q.VendorID == nil || *q.VendorID == "" {
		return nil
	}
	id, err := bson.ObjectIDFromHex(*q.VendorID)
	if err != nil {
		id = bson.ObjectID{}
	}
	return &id
}

func (q itemReq) input() service.ItemInput {
	var related *bson.ObjectID
	if q.RelatedItemID != nil && *q.RelatedItemID != "" {
		id, err := bson.ObjectIDFromHex(*q.RelatedItemID)
		if err != nil {
			id = bson.ObjectID{}
		}
		related = &id
	}
	return service.ItemInput{RelatedItemID: related,
		SubgroupID: q.SubgroupID, Name: q.Name, VendorID: q.vendorOID(), VendorName: q.VendorName, SKU: q.SKU, Quantity: q.Quantity,
		EstimatedUnitPrice: q.EstimatedUnitPrice, Priority: q.Priority, Purpose: q.Purpose, Notes: q.Notes,
		ProductURL: q.ProductURL, AutoFilledFields: q.AutoFilledFields, LookupProvider: q.LookupProvider,
	}
}

func respondItem(w http.ResponseWriter, r *http.Request, status int, it *domain.Item, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, it.Version)
	WriteJSON(w, status, it)
}

func (a *BatchesAPI) listItems(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	items, err := a.Items.List(r.Context(), a.actor(r).Actor, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *BatchesAPI) addItem(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var req itemReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.Add(r.Context(), a.actor(r).Actor, id, req.input())
	respondItem(w, r, http.StatusCreated, it, err)
}

func (a *BatchesAPI) putItem(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req itemReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.Update(r.Context(), a.actor(r).Actor, id, ver, req.input())
	respondItem(w, r, http.StatusOK, it, err)
}

func (a *BatchesAPI) withdrawItem(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.Withdraw(r.Context(), a.actor(r).Actor, id, ver)
	respondItem(w, r, http.StatusOK, it, err)
}

func (a *BatchesAPI) deleteItem(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	if err := a.Items.Delete(r.Context(), a.actor(r).Actor, id, ver); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *BatchesAPI) resubmitItem(w http.ResponseWriter, r *http.Request) {
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
		ResubmitNote string `json:"resubmitNote"`
	}
	if r.ContentLength != 0 {
		if e := decode(r, &req); e != nil {
			WriteError(w, e)
			return
		}
	}
	it, err := a.Items.Resubmit(r.Context(), a.actor(r).Actor, id, ver, req.ResubmitNote)
	respondItem(w, r, http.StatusOK, it, err)
}

func (a *BatchesAPI) forceReject(w http.ResponseWriter, r *http.Request) {
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
		Reason string `json:"reason"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.ForceReject(r.Context(), a.actor(r).Actor, id, ver, req.Reason)
	respondItem(w, r, http.StatusOK, it, err)
}

func (a *BatchesAPI) unpurchasable(w http.ResponseWriter, r *http.Request) {
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
		Reason string `json:"reason"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.MarkUnpurchasable(r.Context(), a.actor(r).Actor, id, ver, req.Reason)
	respondItem(w, r, http.StatusOK, it, err)
}

// reasonItemAction handles the item POSTs that take If-Match and {reason}.
func (a *BatchesAPI) reasonItemAction(w http.ResponseWriter, r *http.Request, do func(ctx context.Context, actor authz.Actor, id bson.ObjectID, ver int64, reason string) (*domain.Item, error)) {
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
		Reason string `json:"reason"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	it, err := do(r.Context(), a.actor(r).Actor, id, ver, req.Reason)
	respondItem(w, r, http.StatusOK, it, err)
}

func (a *BatchesAPI) undoUnpurchasable(w http.ResponseWriter, r *http.Request) {
	a.reasonItemAction(w, r, a.Items.UndoUnpurchasable)
}

func (a *BatchesAPI) undoReview(w http.ResponseWriter, r *http.Request) {
	a.reasonItemAction(w, r, a.Items.UndoReview)
}

func (a *BatchesAPI) copyItem(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	it, err := a.Items.Copy(r.Context(), a.actor(r).Actor, id, ver)
	respondItem(w, r, http.StatusCreated, it, err)
}

func (a *BatchesAPI) review(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var req struct {
		Decisions []struct {
			ItemID   string `json:"itemId"`
			Decision string `json:"decision"`
			Comment  string `json:"comment"`
		} `json:"decisions"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	ds := make([]service.Decision, 0, len(req.Decisions))
	for _, d := range req.Decisions {
		oid, err := bson.ObjectIDFromHex(d.ItemID)
		if err != nil {
			fail(w, r, service.Invalid("decisions", "invalid item id"))
			return
		}
		ds = append(ds, service.Decision{ItemID: oid, Decision: d.Decision, Comment: d.Comment})
	}
	res, err := a.Items.Review(r.Context(), a.actor(r).Actor, id, ds)
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, res.Batch.Version)
	WriteJSON(w, http.StatusOK, map[string]any{"batch": res.Batch, "items": res.Items})
}

// ---- tasks and audit ----

func (a *BatchesAPI) tasks(w http.ResponseWriter, r *http.Request) {
	t, err := a.Tasks.For(r.Context(), a.actor(r).Actor)
	if err != nil {
		fail(w, r, err)
		return
	}
	res := map[string]any{
		"proposalsToHandle": t.ProposalsToHandle, "itemsToReview": t.ItemsToReview, "returnedItems": t.ReturnedItems,
		"reviewsToConfirm": t.ReviewsToConfirm,
	}
	if t.ItemsToPurchase != nil || t.DraftVendorOrders != nil {
		res["itemsToPurchase"] = t.ItemsToPurchase
		if res["itemsToPurchase"] == nil || len(t.ItemsToPurchase) == 0 {
			res["itemsToPurchase"] = []service.VendorTask{}
		}
		res["draftVendorOrders"], res["openProblems"], res["linesToClose"] = t.DraftVendorOrders, t.OpenProblems, t.LinesToClose
	}
	if t.DeliveriesToMatch != nil {
		res["deliveriesToMatch"] = t.DeliveriesToMatch
	}
	WriteJSON(w, http.StatusOK, res)
}

func (a *BatchesAPI) audit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id, e := objectID(q.Get("objectId"))
	if e != nil {
		WriteError(w, e)
		return
	}
	limit, le := parseLimit(r)
	if le != nil {
		WriteError(w, le)
		return
	}
	cursor, err := parseCursor(r)
	if err != nil {
		fail(w, r, err)
		return
	}
	newestFirst := false
	switch q.Get("order") {
	case "", "asc":
	case "desc":
		newestFirst = true
	default:
		fail(w, r, service.Invalid("order", "must be asc or desc"))
		return
	}
	var pg *audit.Page
	switch q.Get("objectType") {
	case "batch":
		pg, err = a.Timeline.ForBatch(r.Context(), a.actor(r).Actor, id, cursor, limit, newestFirst)
	case "item":
		pg, err = a.Timeline.ForItem(r.Context(), a.actor(r).Actor, id, cursor, limit, newestFirst)
	case "vendor_order":
		pg, err = a.Timeline.ForVendorOrder(r.Context(), a.actor(r).Actor, id, cursor, limit, newestFirst)
	case "delivery":
		pg, err = a.Timeline.ForDelivery(r.Context(), a.actor(r).Actor, id, cursor, limit, newestFirst)
	default:
		fail(w, r, service.Invalid("objectType", "must be batch, item, vendor_order or delivery"))
		return
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, newPage(pg.Events, pg.NextCursor))
}

func (a *BatchesAPI) teamAudit(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "teamId")
	if !ok {
		return
	}
	limit, le := parseLimit(r)
	if le != nil {
		WriteError(w, le)
		return
	}
	cursor, err := parseCursor(r)
	if err != nil {
		fail(w, r, err)
		return
	}
	pg, err := a.Timeline.ForTeam(r.Context(), a.actor(r).Actor, id, cursor, limit)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, newPage(pg.Events, pg.NextCursor))
}
