package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// OrdersAPI serves team orders and external orders (vendor transactions).
type OrdersAPI struct {
	Orders    *service.Orders
	VendorTxs *service.VendorTransactions
}

func (a *OrdersAPI) Mount(r chi.Router) {
	r.Get("/batches/{id}/orders", a.listOrders)
	r.Post("/batches/{id}/orders", a.createOrder)
	r.Patch("/orders/{id}", a.patchOrder)
	r.Delete("/orders/{id}", a.cancelOrder)
	r.Post("/vendor-transactions", a.createTx)
	r.Get("/vendor-transactions/{id}", a.getTx)
	r.Patch("/vendor-transactions/{id}", a.patchTx)
	r.Post("/vendor-transactions/{id}/place", a.placeTx)
	r.Post("/vendor-transactions/{id}/cancel", a.cancelTx)
}

func (a *OrdersAPI) actor(r *http.Request) *Caller { return CallerFrom(r.Context()) }

func respondOrder(w http.ResponseWriter, r *http.Request, status int, o *domain.Order, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, o.Version)
	WriteJSON(w, status, o)
}

func respondTx(w http.ResponseWriter, r *http.Request, status int, v *service.VendorTransactionView, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, v.Version)
	WriteJSON(w, status, v)
}

// parseIDs converts hex strings into object ids; a bad one is a field error.
func parseIDs(field string, in []string) ([]bson.ObjectID, error) {
	out := make([]bson.ObjectID, 0, len(in))
	for _, s := range in {
		id, err := bson.ObjectIDFromHex(s)
		if err != nil {
			return nil, service.Invalid(field, "invalid id "+s)
		}
		out = append(out, id)
	}
	return out, nil
}

func (a *OrdersAPI) listOrders(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	orders, err := a.Orders.List(r.Context(), a.actor(r).Actor, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(orders))
}

func (a *OrdersAPI) createOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	var req struct {
		Vendor  string   `json:"vendor"`
		ItemIDs []string `json:"itemIds"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	ids, err := parseIDs("itemIds", req.ItemIDs)
	if err != nil {
		fail(w, r, err)
		return
	}
	o, err := a.Orders.Create(r.Context(), a.actor(r).Actor, id, service.CreateOrderInput{Vendor: req.Vendor, ItemIDs: ids})
	respondOrder(w, r, http.StatusCreated, o, err)
}

func (a *OrdersAPI) patchOrder(w http.ResponseWriter, r *http.Request) {
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
		Vendor  *string   `json:"vendor"`
		ItemIDs *[]string `json:"itemIds"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	p := service.OrderPatch{Vendor: req.Vendor}
	if req.ItemIDs != nil {
		ids, err := parseIDs("itemIds", *req.ItemIDs)
		if err != nil {
			fail(w, r, err)
			return
		}
		p.ItemIDs = &ids
	}
	o, err := a.Orders.Update(r.Context(), a.actor(r).Actor, id, ver, p)
	respondOrder(w, r, http.StatusOK, o, err)
}

func (a *OrdersAPI) cancelOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	o, err := a.Orders.Cancel(r.Context(), a.actor(r).Actor, id, ver)
	respondOrder(w, r, http.StatusOK, o, err)
}

func (a *OrdersAPI) createTx(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderIDs        []string `json:"orderIds"`
		Currency        string   `json:"currency"`
		Vendor          string   `json:"vendor"`
		ExternalOrderNo string   `json:"externalOrderNo"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	ids, err := parseIDs("orderIds", req.OrderIDs)
	if err != nil {
		fail(w, r, err)
		return
	}
	v, err := a.VendorTxs.Create(r.Context(), a.actor(r).Actor, service.CreateVendorTransactionInput{
		OrderIDs: ids, Currency: req.Currency, Vendor: req.Vendor, ExternalOrderNo: req.ExternalOrderNo,
	})
	respondTx(w, r, http.StatusCreated, v, err)
}

func (a *OrdersAPI) getTx(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	v, err := a.VendorTxs.Get(r.Context(), a.actor(r).Actor, id)
	respondTx(w, r, http.StatusOK, v, err)
}

func (a *OrdersAPI) patchTx(w http.ResponseWriter, r *http.Request) {
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
		Vendor               *string                  `json:"vendor"`
		ExternalOrderNo      *string                  `json:"externalOrderNo"`
		PaymentNote          *string                  `json:"paymentNote"`
		ExpectedDeliveryDate optional[time.Time]      `json:"expectedDeliveryDate"`
		SharedCosts          *[]domain.SharedCost     `json:"sharedCosts"`
		ChargedAmountBase    optional[domain.Decimal] `json:"chargedAmountBase"`
		Allocations          optional[[]struct {
			OrderID            string         `json:"orderId"`
			ShareOfSharedCosts domain.Decimal `json:"shareOfSharedCosts"`
		}] `json:"allocations"`
		AllocationOverrideReason *string `json:"allocationOverrideReason"`
		ItemPrices               []struct {
			ItemID          string        `json:"itemId"`
			ActualUnitPrice *domain.Money `json:"actualUnitPrice"`
		} `json:"itemPrices"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	p := service.VendorTxPatch{
		Vendor: req.Vendor, ExternalOrderNo: req.ExternalOrderNo, PaymentNote: req.PaymentNote,
		SharedCosts: req.SharedCosts, OverrideReason: req.AllocationOverrideReason,
		ExpectedDeliverySet: req.ExpectedDeliveryDate.Set,
		ChargedSet:          req.ChargedAmountBase.Set,
		AllocationsSet:      req.Allocations.Set,
	}
	if req.ExpectedDeliveryDate.Set && !req.ExpectedDeliveryDate.Null {
		t := req.ExpectedDeliveryDate.Value.UTC()
		p.ExpectedDelivery = &t
	}
	if req.ChargedAmountBase.Set && !req.ChargedAmountBase.Null {
		d := req.ChargedAmountBase.Value
		p.Charged = &d
	}
	if req.Allocations.Set && !req.Allocations.Null {
		p.Allocations = []service.AllocationInput{}
		for _, a := range req.Allocations.Value {
			oid, err := bson.ObjectIDFromHex(a.OrderID)
			if err != nil {
				fail(w, r, service.Invalid("allocations", "invalid order id"))
				return
			}
			p.Allocations = append(p.Allocations, service.AllocationInput{OrderID: oid, Share: a.ShareOfSharedCosts})
		}
	}
	for _, ip := range req.ItemPrices {
		oid, err := bson.ObjectIDFromHex(ip.ItemID)
		if err != nil {
			fail(w, r, service.Invalid("itemPrices", "invalid item id"))
			return
		}
		p.ItemPrices = append(p.ItemPrices, service.ItemPriceInput{ItemID: oid, Price: ip.ActualUnitPrice})
	}
	v, err := a.VendorTxs.Update(r.Context(), a.actor(r).Actor, id, ver, p)
	respondTx(w, r, http.StatusOK, v, err)
}

func (a *OrdersAPI) placeTx(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	v, err := a.VendorTxs.Place(r.Context(), a.actor(r).Actor, id, ver)
	respondTx(w, r, http.StatusOK, v, err)
}

func (a *OrdersAPI) cancelTx(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	v, err := a.VendorTxs.Cancel(r.Context(), a.actor(r).Actor, id, ver)
	respondTx(w, r, http.StatusOK, v, err)
}
