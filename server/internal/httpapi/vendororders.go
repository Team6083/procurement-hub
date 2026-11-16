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

// VendorOrdersAPI serves purchasing: the queue, vendor orders, lines, the ledger.
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
	r.Post("/vendor-orders/{id}/place", a.place)
	r.Post("/vendor-orders/{id}/unplace", a.unplace)
	r.Post("/vendor-orders/{id}/cancel", a.cancel)
	r.Post("/vendor-orders/{id}/uncancel", a.uncancel)
	r.Post("/vendor-orders/{id}/ledger", a.addLedger)
	r.Post("/ledger-entries/{id}/void", a.voidLedger)
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

type sharedCostReq struct {
	Type   string `json:"type"`
	Amount string `json:"amount"`
	Note   string `json:"note"`
}

type overrideReq struct {
	TeamID string `json:"teamId"`
	Amount string `json:"amount"`
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
		VendorID          string          `json:"vendorId"`
		Currency          string          `json:"currency"`
		ExternalOrderNo   string          `json:"externalOrderNo"`
		SharedCosts       []sharedCostReq `json:"sharedCosts"`
		TeamCostOverrides []overrideReq   `json:"teamCostOverrides"`
		OverrideReason    string          `json:"overrideReason"`
		ChargedAmountBase *string         `json:"chargedAmountBase"`
		ExpectedDelivery  string          `json:"expectedDeliveryDate"`
		PaymentNote       string          `json:"paymentNote"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	f := service.OrderFields{Currency: req.Currency, ExternalOrderNo: req.ExternalOrderNo, OverrideReason: req.OverrideReason,
		ExpectedDelivery: req.ExpectedDelivery, PaymentNote: req.PaymentNote}
	var err error
	if f.VendorID, err = bson.ObjectIDFromHex(req.VendorID); err != nil {
		fail(w, r, service.Invalid("vendorId", "must be a vendor id"))
		return
	}
	for _, sc := range req.SharedCosts {
		amt, err := optDecimal("sharedCosts", &sc.Amount)
		if err != nil || amt == nil {
			fail(w, r, service.Invalid("sharedCosts", "amount must be a decimal string"))
			return
		}
		f.SharedCosts = append(f.SharedCosts, domain.SharedCost{Type: sc.Type, Amount: *amt, Note: sc.Note})
	}
	if req.TeamCostOverrides != nil {
		f.TeamCostOverrides = []domain.TeamCostOverride{}
		for _, o := range req.TeamCostOverrides {
			tid, terr := bson.ObjectIDFromHex(o.TeamID)
			amt, aerr := optDecimal("teamCostOverrides", &o.Amount)
			if terr != nil || aerr != nil || amt == nil {
				fail(w, r, service.Invalid("teamCostOverrides", "needs a team id and a decimal amount"))
				return
			}
			f.TeamCostOverrides = append(f.TeamCostOverrides, domain.TeamCostOverride{TeamID: tid, Amount: *amt})
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

func (a *VendorOrdersAPI) voidLedger(w http.ResponseWriter, r *http.Request) {
	a.reasonAction(w, r, func(r *http.Request, id bson.ObjectID, ver int64, reason string) (*service.OrderDetail, error) {
		return a.Orders.VoidLedger(r.Context(), CallerFrom(r.Context()).Actor, id, ver, reason)
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
		Type       domain.LineStatus `json:"type"`
		Reason     string            `json:"reason"`
		RefundBase *string           `json:"refundBase"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	in := service.CloseInput{Type: req.Type, Reason: req.Reason}
	if req.RefundBase != nil {
		in.RefundBase = *req.RefundBase
	}
	d, err := a.Orders.CloseLine(r.Context(), CallerFrom(r.Context()).Actor, id, ver, in)
	respondOrder(w, r, http.StatusOK, d, err)
}

func (a *VendorOrdersAPI) addLedger(w http.ResponseWriter, r *http.Request) {
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
		AmountBase string  `json:"amountBase"`
		LineID     *string `json:"vendorOrderLineId"`
		Reason     string  `json:"reason"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	lid, err := optID("vendorOrderLineId", req.LineID)
	if err != nil {
		fail(w, r, err)
		return
	}
	d, err := a.Orders.AddLedger(r.Context(), CallerFrom(r.Context()).Actor, id, ver, service.LedgerInput{AmountBase: req.AmountBase, LineID: lid, Reason: req.Reason})
	respondOrder(w, r, http.StatusCreated, d, err)
}
