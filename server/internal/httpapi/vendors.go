package httpapi

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/service"
)

// VendorsAPI serves the vendor list and the global reference rates.
type VendorsAPI struct{ Vendors *service.Vendors }

func (a *VendorsAPI) Mount(r chi.Router) {
	r.Get("/vendors", a.list)
	r.Post("/vendors", a.create)
	r.Put("/vendors/{id}", a.put)
	r.Get("/reference-rates", a.listRates)
	r.Put("/reference-rates/{currency}", a.putRate)
	r.Delete("/reference-rates/{currency}", a.deleteRate)
}

type vendorReq struct {
	Name            string   `json:"name"`
	Aliases         []string `json:"aliases"`
	DefaultCurrency string   `json:"defaultCurrency"`
	Website         string   `json:"website"`
	Notes           string   `json:"notes"`
	Active          bool     `json:"active"`
}

func (q vendorReq) input() service.VendorInput {
	return service.VendorInput{Name: q.Name, Aliases: q.Aliases, DefaultCurrency: q.DefaultCurrency, Website: q.Website, Notes: q.Notes, Active: q.Active}
}

func respondVendor(w http.ResponseWriter, r *http.Request, status int, v *domain.Vendor, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	setETag(w, v.Version)
	WriteJSON(w, status, v)
}

func (a *VendorsAPI) list(w http.ResponseWriter, r *http.Request) {
	inc, _ := strconv.ParseBool(r.URL.Query().Get("includeInactive"))
	vs, err := a.Vendors.List(r.Context(), r.URL.Query().Get("q"), inc)
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(vs))
}

func (a *VendorsAPI) create(w http.ResponseWriter, r *http.Request) {
	var req vendorReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	v, err := a.Vendors.Create(r.Context(), CallerFrom(r.Context()).Actor, req.input())
	respondVendor(w, r, http.StatusCreated, v, err)
}

func (a *VendorsAPI) put(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "id")
	if !ok {
		return
	}
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	var req vendorReq
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	v, err := a.Vendors.Replace(r.Context(), CallerFrom(r.Context()).Actor, id, ver, req.input())
	respondVendor(w, r, http.StatusOK, v, err)
}

func (a *VendorsAPI) listRates(w http.ResponseWriter, r *http.Request) {
	rs, err := a.Vendors.ListRates(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, wholeList(rs))
}

func (a *VendorsAPI) putRate(w http.ResponseWriter, r *http.Request) {
	var ver int64 // 0 creates; an existing currency needs If-Match
	if r.Header.Get("If-Match") != "" {
		v, e := ifMatch(r)
		if e != nil {
			WriteError(w, e)
			return
		}
		ver = v
	}
	var req struct {
		RateToBase string `json:"rateToBase"`
	}
	if e := decode(r, &req); e != nil {
		WriteError(w, e)
		return
	}
	rate, created, err := a.Vendors.PutRate(r.Context(), CallerFrom(r.Context()).Actor, chi.URLParam(r, "currency"), req.RateToBase, ver)
	if err != nil {
		if ver == 0 && err == service.ErrVersionConflict {
			WriteError(w, NewError(http.StatusPreconditionRequired, "if_match_required", "If-Match header is required."))
			return
		}
		fail(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	setETag(w, rate.Version)
	WriteJSON(w, status, rate)
}

func (a *VendorsAPI) deleteRate(w http.ResponseWriter, r *http.Request) {
	ver, e := ifMatch(r)
	if e != nil {
		WriteError(w, e)
		return
	}
	if err := a.Vendors.DeleteRate(r.Context(), CallerFrom(r.Context()).Actor, chi.URLParam(r, "currency"), ver); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
