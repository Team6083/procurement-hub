package service

import (
	"sort"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// VendorGroup is the items of one vendor. VendorID nil is the "other" group: items
// without a vendor from the list, in the order of their typed vendor names.
type VendorGroup[T any] struct {
	VendorID *bson.ObjectID
	// Name is the vendor's name; empty for the "other" group.
	Name string
	// Inactive marks a vendor that was deactivated; its items still form its own group.
	Inactive bool
	Items    []T
}

// GroupByVendor is the one rule behind every vendor grouping of items to purchase
// (the purchasing overview, the queue and /me/tasks). An item belongs to a vendor only
// through its vendorId; a typed vendor name is never matched here (that happens when
// the item is written, see matchVendor). Pass all vendors, inactive ones included.
// Groups are sorted by vendor name with "other" last; items keep their order, except
// in "other", where they are sorted by typed vendor name.
func GroupByVendor[T any](items []T, vendors []domain.Vendor, vendorID func(T) *bson.ObjectID, typedName func(T) string) []VendorGroup[T] {
	byID := map[bson.ObjectID]domain.Vendor{}
	for _, v := range vendors {
		byID[v.ID] = v
	}
	groups := map[bson.ObjectID]*VendorGroup[T]{}
	var ordered []*VendorGroup[T]
	other := &VendorGroup[T]{}
	for _, it := range items {
		id := vendorID(it)
		if id == nil {
			other.Items = append(other.Items, it)
			continue
		}
		g, ok := groups[*id]
		if !ok {
			v, known := byID[*id]
			name := v.Name
			if !known {
				name = typedName(it)
			}
			vid := *id
			g = &VendorGroup[T]{VendorID: &vid, Name: name, Inactive: known && !v.Active}
			groups[*id] = g
			ordered = append(ordered, g)
		}
		g.Items = append(g.Items, it)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := strings.ToLower(ordered[i].Name), strings.ToLower(ordered[j].Name)
		if a != b {
			return a < b
		}
		return ordered[i].VendorID.Hex() < ordered[j].VendorID.Hex()
	})
	sort.SliceStable(other.Items, func(i, j int) bool {
		return strings.ToLower(typedName(other.Items[i])) < strings.ToLower(typedName(other.Items[j]))
	})
	out := make([]VendorGroup[T], 0, len(ordered)+1)
	for _, g := range ordered {
		out = append(out, *g)
	}
	if len(other.Items) > 0 {
		out = append(out, *other)
	}
	return out
}
