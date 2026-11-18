package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// VendorOrdersAPI serves purchasing: the queue, vendor orders and lines.
type VendorOrdersAPI struct{ Orders *service.VendorOrders }

func (a *VendorOrdersAPI) Mount(r chi.Router) {
	r.Get("/purchasing/queue", a.queue)
	r.Get("/vendor-orders", a.list)
	r.Post("/vendor-orders", a.create)
	r.Get("/vendor-orders/{id}", a.get)
	r.Put("/vendor-orders/{id}", a.put)
	r.Post("/vendor-orders/{id}/lines", a.addLine)
	r.Get("/vendor-order-lines", a.linesToClose)
	r.Put("/vendor-order-lines/{id}", a.putLine)
	r.Delete("/vendor-order-lines/{id}", a.deleteLine)
	r.Post("/vendor-order-lines/{id}/close", a.closeLine)
	r.Post("/vendor-order-lines/{id}/reopen", a.reopenLine)
	r.Post("/vendor-orders/{id}/cost-entries", a.createCostEntry)
	r.Put("/cost-entries/{id}", a.putCostEntry)
	r.Delete("/cost-entries/{id}", a.deleteCostEntry)
	r.Post("/cost-entries/{id}/void", a.voidCostEntry)
	r.Post("/vendor-orders/{id}/place", a.place)
	r.Post("/vendor-orders/{id}/unplace", a.unplace)
	r.Post("/vendor-orders/{id}/cancel", a.cancel)
	r.Post("/vendor-orders/{id}/uncancel", a.uncancel)
}

func respondOrder(w http.ResponseWriter, r *http.Request, status int, d *service.OrderDetail, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, d.Version)
	WriteJSON(w, status, d)
}

// optDecimal parses an optional decimal string field.
func optDecimal(field string, s *string) (*domain.Decimal, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil, nil
	}
	d, err := decimal.NewFromString(strings.TrimSpace(*s))
	if err != nil {
		return nil, service.Invalid(field, "must be a decimal string")
	}
	return &domain.Decimal{Decimal: d}, nil
}

func optID(field string, s *string) (*bson.ObjectID, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	id, err := bson.ObjectIDFromHex(*s)
	if err != nil {
		return nil, service.Invalid(field, "must be an id")
	}
	return &id, nil
}

func queryID(r *http.Request, name string) (bson.ObjectID, error) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return bson.ObjectID{}, nil
	}
	id, err := bson.ObjectIDFromHex(v)
	if err != nil {
		return id, service.Invalid(name, "must be an id")
	}
	return id, nil
}

func (a *VendorOrdersAPI) queue(w http.ResponseWriter, r *http.Request) {
	var f service.QueueFilter
	var err error
	if f.VendorID, err = queryID(r, "vendorId"); err == nil {
		if f.TeamID, err = queryID(r, "teamId"); err == nil {
			f.BatchID, err = queryID(r, "batchId")
		}
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	groups, err := a.Orders.Queue(r.Context(), CallerFrom(r.Context()).Actor, f)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(groups))
}

func (a *VendorOrdersAPI) list(w http.ResponseWriter, r *http.Request) {
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
	in := service.ListOrdersInput{Status: domain.OrderStatus(q.Get("status")), Query: q.Get("q"), Cursor: cursor, Limit: limit}
	if in.VendorID, err = queryID(r, "vendorId"); err == nil {
		in.TeamID, err = queryID(r, "teamId")
	}
	if err == nil {
		switch o := q.Get("ownerId"); o {
		case "":
		case "me":
			in.OwnerID = CallerFrom(r.Context()).Actor.UserID
		default:
			in.OwnerID, err = queryID(r, "ownerId")
		}
	}
	if err == nil {
		switch c := q.Get("completed"); c {
		case "":
		case "true", "false":
			b := c == "true"
			in.Completed = &b
		default:
			err = service.Invalid("completed", "must be true or false")
		}
		in.Receiving, in.Accounting = q.Get("receivingState"), q.Get("accountingState")
		if rs := in.Receiving; rs != "" && rs != domain.ReceivingNone && rs != domain.ReceivingPartial && rs != domain.ReceivingClosed {
			err = service.Invalid("receivingState", "must be none, partial or closed")
		}
		if as := in.Accounting; as != "" && as != domain.AccountingIncomplete && as != domain.AccountingProvisional && as != domain.AccountingFinal {
			err = service.Invalid("accountingState", "must be incomplete, provisional or final")
		}
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	if in.Status != "" && in.Status != domain.OrderDraft && in.Status != domain.OrderPlaced && in.Status != domain.OrderCancelled {
		fail(w, r, service.Invalid("status", "must be draft, placed or cancelled"))
		return
	}
	p, err := a.Orders.List(r.Context(), CallerFrom(r.Context()).Actor, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, newPage(p.Items, p.NextCursor))
}

func (a *VendorOrdersAPI) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VendorID string   `json:"vendorId"`
		Currency string   `json:"currency"`
		ItemIDs  []string `json:"itemIds"`
		OwnerIDs []string `json:"ownerIds"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	vid, err := bson.ObjectIDFromHex(req.VendorID)
	if err != nil {
		fail(w, r, service.Invalid("vendorId", "must be a vendor id"))
		return
	}
	in := service.CreateOrderInput{VendorID: vid, Currency: req.Currency}
	for _, s := range req.ItemIDs {
		id, err := bson.ObjectIDFromHex(s)
		if err != nil {
			fail(w, r, service.Invalid("itemIds", "must be item ids"))
			return
		}
		in.ItemIDs = append(in.ItemIDs, id)
	}
	if req.OwnerIDs != nil {
		in.OwnerIDs = []bson.ObjectID{}
		for _, s := range req.OwnerIDs {
			id, err := bson.ObjectIDFromHex(s)
			if err != nil {
				fail(w, r, service.Invalid("ownerIds", "must be user ids"))
				return
			}
			in.OwnerIDs = append(in.OwnerIDs, id)
		}
	}
	d, err := a.Orders.Create(r.Context(), CallerFrom(r.Context()).Actor, in)
	respondOrder(w, r, http.StatusCreated, d, err)
}

func (a *VendorOrdersAPI) get(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	d, err := a.Orders.Get(r.Context(), CallerFrom(r.Context()).Actor, id)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) put(w http.ResponseWriter, r *http.Request) {
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
		VendorID          string   `json:"vendorId"`
		Currency          string   `json:"currency"`
		OwnerIDs          []string `json:"ownerIds"`
		ExternalOrderNo   string   `json:"externalOrderNo"`
		ChargedAmountBase *string  `json:"chargedAmountBase"`
		ExpectedDelivery  string   `json:"expectedDeliveryDate"`
		PaymentNote       string   `json:"paymentNote"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	f := service.OrderFields{Currency: req.Currency, ExternalOrderNo: req.ExternalOrderNo,
		ExpectedDelivery: req.ExpectedDelivery, PaymentNote: req.PaymentNote}
	var err error
	if f.VendorID, err = bson.ObjectIDFromHex(req.VendorID); err != nil {
		fail(w, r, service.Invalid("vendorId", "must be a vendor id"))
		return
	}
	if req.OwnerIDs != nil {
		f.OwnerIDs = []bson.ObjectID{}
		for _, s := range req.OwnerIDs {
			id, err := bson.ObjectIDFromHex(s)
			if err != nil {
				fail(w, r, service.Invalid("ownerIds", "must be user ids"))
				return
			}
			f.OwnerIDs = append(f.OwnerIDs, id)
		}
	}
	if f.ChargedAmountBase, err = optDecimal("chargedAmountBase", req.ChargedAmountBase); err != nil {
		fail(w, r, err)
		return
	}
	d, err := a.Orders.Replace(r.Context(), CallerFrom(r.Context()).Actor, id, ver, f)
	respondOrder(w, r, http.StatusOK, d, err)
}

type lineReq struct {
	ItemID    *string `json:"itemId"`
	TeamID    *string `json:"teamId"`
	Name      *string `json:"name"`
	SKU       *string `json:"sku"`
	Quantity  *int    `json:"quantity"`
	UnitPrice *string `json:"unitPrice"`
}

func (a *VendorOrdersAPI) addLine(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req lineReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	itemID, err := optID("itemId", req.ItemID)
	if err != nil {
		fail(w, r, err)
		return
	}
	teamID, err := optID("teamId", req.TeamID)
	if err != nil {
		fail(w, r, err)
		return
	}
	price, err := optDecimal("unitPrice", req.UnitPrice)
	if err != nil {
		fail(w, r, err)
		return
	}
	d, err := a.Orders.AddLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver,
		service.NewAddLineInput(itemID, teamID, req.Name, req.SKU, req.Quantity, price))
	respondOrder(w, r, http.StatusCreated, d, err)
}

func (a *VendorOrdersAPI) putLine(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req lineReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	teamID, err := optID("teamId", req.TeamID)
	if err != nil {
		fail(w, r, err)
		return
	}
	price, err := optDecimal("unitPrice", req.UnitPrice)
	if err != nil {
		fail(w, r, err)
		return
	}
	d, err := a.Orders.ReplaceLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver, service.NewLineFields(teamID, req.Name, req.SKU, req.Quantity, price))
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) deleteLine(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	d, err := a.Orders.DeleteLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) linesToClose(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("toClose") != "true" {
		fail(w, r, service.Invalid("toClose", "must be true"))
		return
	}
	lines, err := a.Orders.LinesToClose(r.Context(), CallerFrom(r.Context()).Actor)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(lines))
}

// reasonAction parses If-Match and {reason} for an order action.
func (a *VendorOrdersAPI) reasonAction(w http.ResponseWriter, r *http.Request, do func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error)) {
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
	d, err := do(r, id, ver, req.Reason)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) place(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	d, err := a.Orders.Place(r.Context(), CallerFrom(r.Context()).Actor, id, ver)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) unplace(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.Unplace(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	})
}

func (a *VendorOrdersAPI) cancel(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.Cancel(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	})
}

func (a *VendorOrdersAPI) uncancel(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.Uncancel(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	})
}

func (a *VendorOrdersAPI) reopenLine(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.ReopenLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	})
}

func (a *VendorOrdersAPI) closeLine(w http.ResponseWriter, r *http.Request) {
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
		Type   domain.LineStatus `json:"type"`
		Reason string            `json:"reason"`
		Refund *refundReq        `json:"refund"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.CloseInput{Type: req.Type, Reason: req.Reason, Refund: req.Refund.input()}
	d, err := a.Orders.CloseLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	respondOrder(w, r, http.StatusOK, d, err)
}

// refundReq is the refund object of a closure or problem resolution.
type refundReq struct {
	Currency         string `json:"currency"`
	Amount           string `json:"amount"`
	ActualAmountBase string `json:"actualAmountBase"`
	Method           string `json:"method"`
	Note             string `json:"note"`
}

func (r *refundReq) input() *service.RefundInput {
	if r == nil {
		return nil
	}
	return &service.RefundInput{Currency: r.Currency, Amount: r.Amount, ActualAmountBase: r.ActualAmountBase, Method: r.Method, Note: r.Note}
}

type costEntryReq struct {
	Type             string             `json:"type"`
	Settlement       string             `json:"settlement"`
	Currency         string             `json:"currency"`
	Amount           string             `json:"amount"`
	ActualAmountBase *string            `json:"actualAmountBase"`
	RefundMethod     *string            `json:"refundMethod"`
	Allocation       *domain.Allocation `json:"allocation"`
	Note             string             `json:"note"`
}

func (c costEntryReq) input() service.CostEntryInput {
	in := service.CostEntryInput{Type: c.Type, Settlement: c.Settlement, Currency: c.Currency, Amount: c.Amount, Note: c.Note}
	if c.ActualAmountBase != nil {
		in.ActualAmountBase = *c.ActualAmountBase
	}
	if c.RefundMethod != nil {
		in.RefundMethod = *c.RefundMethod
	}
	if c.Allocation != nil {
		in.Allocation = *c.Allocation
	}
	return in
}

// costEntryWrite parses If-Match and the body shared by create and replace.
func costEntryWrite(w http.ResponseWriter, r *http.Request) (id bson.ObjectID, ver int64, in service.CostEntryInput, ok bool) {
	id, ok = idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return id, ver, in, false
	}
	var req costEntryReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return id, ver, in, false
	}
	return id, ver, req.input(), true
}

func (a *VendorOrdersAPI) createCostEntry(w http.ResponseWriter, r *http.Request) {
	id, ver, in, ok := costEntryWrite(w, r)
	if !ok {
		return
	}
	d, err := a.Orders.CreateCostEntry(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	respondOrder(w, r, http.StatusCreated, d, err)
}

func (a *VendorOrdersAPI) putCostEntry(w http.ResponseWriter, r *http.Request) {
	id, ver, in, ok := costEntryWrite(w, r)
	if !ok {
		return
	}
	d, err := a.Orders.ReplaceCostEntry(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) deleteCostEntry(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	d, err := a.Orders.DeleteCostEntry(r.Context(), CallerFrom(r.Context()).Actor, id, ver)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) voidCostEntry(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.VoidCostEntry(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
	})
}
