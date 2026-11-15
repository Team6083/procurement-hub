package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// ReceivingAPI serves receiving records, exceptions and order adjustments.
type ReceivingAPI struct {
	Receiving *service.Receiving
}

func (a *ReceivingAPI) Mount(r chi.Router) {
	r.Get("/items/{id}/receipts", a.listReceipts)
	r.Post("/items/{id}/receipts", a.recordReceipt)
	r.Get("/items/{id}/exceptions", a.listExceptions)
	r.Post("/items/{id}/exceptions", a.reportException)
	r.Post("/exceptions/{id}/resolve", a.resolve)
	r.Post("/orders/{id}/adjustments", a.addAdjustment)
}

func (a *ReceivingAPI) actor(r *http.Request) *Caller { return CallerFrom(r.Context()) }

func (a *ReceivingAPI) listReceipts(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	rs, err := a.Receiving.ListReceipts(r.Context(), a.actor(r).Actor, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(rs))
}

func (a *ReceivingAPI) recordReceipt(w http.ResponseWriter, r *http.Request) {
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
		Quantity int    `json:"quantity"`
		Note     string `json:"note"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	res, err := a.Receiving.RecordReceipt(r.Context(), a.actor(r).Actor, id, ver, service.ReceiptInput{Quantity: req.Quantity, Note: req.Note})
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, res.Item.Version)
	WriteJSON(w, http.StatusCreated, res)
}

func (a *ReceivingAPI) listExceptions(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	es, err := a.Receiving.ListExceptions(r.Context(), a.actor(r).Actor, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(es))
}

func (a *ReceivingAPI) reportException(w http.ResponseWriter, r *http.Request) {
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
		Type        domain.ExceptionType `json:"type"`
		Description string               `json:"description"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	res, err := a.Receiving.ReportException(r.Context(), a.actor(r).Actor, id, ver, service.ExceptionInput{Type: req.Type, Description: req.Description})
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, res.Item.Version)
	WriteJSON(w, http.StatusCreated, res)
}

func (a *ReceivingAPI) resolve(w http.ResponseWriter, r *http.Request) {
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
		Action           domain.ExceptionAction `json:"action"`
		Note             string                 `json:"note"`
		RefundAmountBase *domain.Decimal        `json:"refundAmountBase"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.ResolveInput{Action: req.Action, Note: req.Note}
	if req.RefundAmountBase != nil {
		d := req.RefundAmountBase.Decimal
		in.Refund = &d
	}
	res, err := a.Receiving.Resolve(r.Context(), a.actor(r).Actor, id, ver, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, res.Exception.Version)
	WriteJSON(w, http.StatusOK, res)
}

func (a *ReceivingAPI) addAdjustment(w http.ResponseWriter, r *http.Request) {
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
		AmountBase domain.Decimal `json:"amountBase"`
		Reason     string         `json:"reason"`
		ItemID     *string        `json:"itemId"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.AdjustmentInput{AmountBase: req.AmountBase.Decimal, Reason: req.Reason}
	if req.ItemID != nil {
		iid, err := bson.ObjectIDFromHex(*req.ItemID)
		if err != nil {
			fail(w, r, service.Invalid("itemId", "invalid id"))
			return
		}
		in.ItemID = &iid
	}
	res, err := a.Receiving.AddAdjustment(r.Context(), a.actor(r).Actor, id, ver, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, res.Order.Version)
	WriteJSON(w, http.StatusCreated, res)
}
