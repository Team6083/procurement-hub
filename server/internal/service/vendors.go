package service

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// JobVendorOrdersRecompute recomputes vendor orders after a reference rate
// changed; keyed per currency so repeated writes coalesce (spec §13.1).
const JobVendorOrdersRecompute = "vendor_orders.recompute"

func recomputeJobKey(currency string) string { return JobVendorOrdersRecompute + ":" + currency }

// Vendors serves the shared vendor list and the global reference rates.
type Vendors struct {
	st        *store.Store
	audit     *audit.Log
	base      string
	supported []string
}

func NewVendors(st *store.Store, a *audit.Log, base string, supported []string) *Vendors {
	return &Vendors{st: st, audit: a, base: base, supported: supported}
}

// ---- vendors ----

type VendorInput struct {
	Name            string
	Aliases         []string
	DefaultCurrency string
	Website         string
	Notes           string
	Active          bool
}

// List is open to every signed-in user (spec §8.2); q matches name or aliases.
func (s *Vendors) List(ctx context.Context, q string, includeInactive bool) ([]domain.Vendor, error) {
	all, err := s.st.ListVendors(ctx, includeInactive)
	if err != nil {
		return nil, err
	}
	key := domain.VendorKey(q)
	out := []domain.Vendor{}
	for _, v := range all {
		if key == "" || strings.Contains(v.NameKey, key) || anyContains(v.AliasKeys, key) {
			out = append(out, v)
		}
	}
	return out, nil
}

func anyContains(xs []string, sub string) bool {
	for _, x := range xs {
		if strings.Contains(x, sub) {
			return true
		}
	}
	return false
}

func canWriteVendors(a authz.Actor) bool { return a.IsPurchaser || a.IsSystemAdmin }

// normalise validates the input and fills the document's normalised keys.
func (s *Vendors) normalise(in VendorInput, v *domain.Vendor) error {
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 200 {
		return Invalid("name", "required, at most 200 characters")
	}
	cur := strings.ToUpper(strings.TrimSpace(in.DefaultCurrency))
	if cur == "" {
		cur = s.base
	}
	if cur != s.base && !contains(s.supported, cur) {
		return Invalid("defaultCurrency", cur+" is not a supported currency")
	}
	if w := strings.TrimSpace(in.Website); w != "" {
		u, err := url.Parse(w)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return Invalid("website", "must be an http(s) URL")
		}
	}
	nameKey := domain.VendorKey(name)
	seen := map[string]bool{nameKey: true}
	aliases := []string{}
	var keys []string
	for _, a := range in.Aliases {
		a = strings.TrimSpace(a)
		k := domain.VendorKey(a)
		if k == "" || seen[k] {
			continue // blank, duplicate, or same as the name
		}
		seen[k] = true
		aliases = append(aliases, a)
		keys = append(keys, k)
	}
	v.Name, v.Aliases, v.DefaultCurrency = name, aliases, cur
	v.Website, v.Notes, v.Active = strings.TrimSpace(in.Website), in.Notes, in.Active
	v.NameKey, v.AliasKeys = nameKey, keys
	return nil
}

// checkKeys refuses a name or alias already used by another vendor, in either
// role (case-insensitive, trimmed). Run inside the write's transaction.
func (s *Vendors) checkKeys(ctx context.Context, v *domain.Vendor) error {
	keys := append([]string{v.NameKey}, v.AliasKeys...)
	if other, err := s.st.VendorKeyOwner(ctx, v.ID, keys); err != nil {
		return err
	} else if other != nil {
		return Rule("vendor_name_taken", "The name or an alias is already used by vendor %q.", other.Name)
	}
	return nil
}

func (s *Vendors) Create(ctx context.Context, actor authz.Actor, in VendorInput) (*domain.Vendor, error) {
	if !canWriteVendors(actor) {
		return nil, ErrForbidden
	}
	in.Active = true
	v := &domain.Vendor{}
	if err := s.normalise(in, v); err != nil {
		return nil, err
	}
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		if err := s.checkKeys(ctx, v); err != nil {
			return err
		}
		if err := s.st.InsertVendor(ctx, v); err != nil {
			return mapVendorErr(err)
		}
		return s.audit.Record(ctx, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "vendor", ObjectID: v.ID.Hex(),
			Action: "vendor.created", Changes: []domain.AuditChange{{Field: "name", From: nil, To: v.Name}}})
	})
	return v, err
}

// Replace is PUT: every editable field is replaced (spec §16.1).
func (s *Vendors) Replace(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in VendorInput) (*domain.Vendor, error) {
	if !canWriteVendors(actor) {
		return nil, ErrForbidden
	}
	var out *domain.Vendor
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		old, err := s.st.GetVendor(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		next := &domain.Vendor{ID: id}
		if err := s.normalise(in, next); err != nil {
			return err
		}
		if err := s.checkKeys(ctx, next); err != nil {
			return err
		}
		out, err = s.st.UpdateVendor(ctx, id, version, bson.D{
			{Key: "name", Value: next.Name}, {Key: "aliases", Value: next.Aliases}, {Key: "defaultCurrency", Value: next.DefaultCurrency},
			{Key: "website", Value: next.Website}, {Key: "notes", Value: next.Notes}, {Key: "active", Value: next.Active},
			{Key: "nameKey", Value: next.NameKey}, {Key: "aliasKeys", Value: next.AliasKeys},
		})
		if err != nil {
			return mapVendorErr(err)
		}
		return s.audit.Record(ctx, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "vendor", ObjectID: id.Hex(),
			Action: "vendor.updated", Changes: []domain.AuditChange{{Field: "vendor", From: old, To: out}}})
	})
	return out, err
}

func mapVendorErr(err error) error {
	if errors.Is(err, store.ErrDuplicate) {
		return Rule("vendor_name_taken", "The name or an alias is already used by another vendor.")
	}
	return mapStore(err)
}

// ---- reference rates ----

func (s *Vendors) ListRates(ctx context.Context) ([]domain.GlobalRate, error) {
	rs, err := s.st.ListRates(ctx)
	if rs == nil {
		rs = []domain.GlobalRate{}
	}
	return rs, err
}

// PutRate creates (version == 0) or replaces the currency's rate; system admins only.
// Every write schedules vendor_orders.recompute for the currency.
func (s *Vendors) PutRate(ctx context.Context, actor authz.Actor, currency, rateToBase string, version int64) (*domain.GlobalRate, bool, error) {
	if !actor.IsSystemAdmin {
		return nil, false, ErrForbidden
	}
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if cur == s.base {
		return nil, false, Invalid("currency", "the base currency needs no rate")
	}
	if !contains(s.supported, cur) {
		return nil, false, Invalid("currency", cur+" is not a supported currency")
	}
	d, err := decimal.NewFromString(rateToBase)
	if err != nil || !d.IsPositive() {
		return nil, false, Invalid("rateToBase", "must be a positive decimal string")
	}
	if !domain.FitsDigits(d, domain.MaxRateDigits) {
		return nil, false, Invalid("rateToBase", "at most 6 fractional digits")
	}
	rate := domain.Decimal{Decimal: d}
	var out *domain.GlobalRate
	created := false
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		prev, gerr := s.st.GetRate(ctx, cur)
		switch {
		case errors.Is(gerr, store.ErrNotFound):
			if version != 0 {
				return ErrNotFound
			}
			out = &domain.GlobalRate{Currency: cur, RateToBase: rate, UpdatedBy: actor.UserID.Hex()}
			if err := s.st.InsertRate(ctx, out); err != nil {
				return mapStore(err)
			}
			created = true
		case gerr != nil:
			return gerr
		default:
			if version == 0 {
				return ErrVersionConflict // exists: a modification needs If-Match
			}
			if out, err = s.st.UpdateRate(ctx, cur, version, rate, actor.UserID.Hex()); err != nil {
				return mapStore(err)
			}
		}
		var from any
		if prev != nil {
			from = prev.RateToBase.String()
		}
		if err := s.scheduleRecompute(ctx, cur); err != nil {
			return err
		}
		return s.audit.Record(ctx, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "reference_rate", ObjectID: cur,
			Action: "reference_rate.set", Changes: []domain.AuditChange{{Field: "rateToBase", From: from, To: d.String()}}})
	})
	return out, created, err
}

func (s *Vendors) DeleteRate(ctx context.Context, actor authz.Actor, currency string, version int64) error {
	if !actor.IsSystemAdmin {
		return ErrForbidden
	}
	cur := strings.ToUpper(strings.TrimSpace(currency))
	return s.st.WithTx(ctx, func(ctx context.Context) error {
		prev, err := s.st.GetRate(ctx, cur)
		if err != nil {
			return mapStore(err)
		}
		if err := s.st.DeleteRate(ctx, cur, version); err != nil {
			return mapStore(err)
		}
		if err := s.scheduleRecompute(ctx, cur); err != nil {
			return err
		}
		return s.audit.Record(ctx, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "reference_rate", ObjectID: cur,
			Action: "reference_rate.deleted", Changes: []domain.AuditChange{{Field: "rateToBase", From: prev.RateToBase.String(), To: nil}}})
	})
}

func (s *Vendors) scheduleRecompute(ctx context.Context, currency string) error {
	return s.st.UpsertJob(ctx, recomputeJobKey(currency), JobVendorOrdersRecompute, bsonNow(), bson.M{"currency": currency})
}
