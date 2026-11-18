package service

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// VendorOrders serves vendor orders, their lines and cost entries (spec §10.3, §11).
type VendorOrders struct {
	st        *store.Store
	audit     *audit.Log
	batches   *Batches
	supported []string
}

func NewVendorOrders(st *store.Store, a *audit.Log, b *Batches, supported []string) *VendorOrders {
	return &VendorOrders{st: st, audit: a, batches: b, supported: supported}
}

// privileged reports whether the caller reads every order (spec §8.2).
func privileged(a authz.Actor) bool { return a.IsPurchaser || a.IsReceiver || a.IsSystemAdmin }

// ---- visibility ----

// lineAccess decides which lines a regular user sees: lines of their own teams
// and lines whose batch they can read (spec §8.2).
type lineAccess struct {
	s       *VendorOrders
	ctx     context.Context
	actor   authz.Actor
	batches map[bson.ObjectID]bool
}

func (s *VendorOrders) access(ctx context.Context, actor authz.Actor) *lineAccess {
	return &lineAccess{s: s, ctx: ctx, actor: actor, batches: map[bson.ObjectID]bool{}}
}

func (a *lineAccess) sees(l *domain.VendorOrderLine) bool {
	if privileged(a.actor) || a.actor.IsMember(l.TeamID) {
		return true
	}
	return l.BatchID != nil && a.canReadBatch(*l.BatchID)
}

func (a *lineAccess) canReadBatch(id bson.ObjectID) bool {
	if v, ok := a.batches[id]; ok {
		return v
	}
	ok := false
	if b, err := a.s.st.GetBatch(a.ctx, id); err == nil {
		if t, err := a.s.st.GetTeam(a.ctx, b.TeamID); err == nil {
			ok = a.actor.CanReadBatch(t.ID, t.Visibility, b.VisibilityOverride)
		}
	}
	a.batches[id] = ok
	return ok
}

// ---- views ----

// LineView is a line with the version its writes need in If-Match.
type LineView struct {
	domain.VendorOrderLine
	// ProductURL is the item's current product URL, read at request time; empty without an item or URL.
	ProductURL string `json:"productUrl"`
	// EstimatedUnitPrice is the item's current estimate; null without an item.
	EstimatedUnitPrice *domain.Money    `json:"estimatedUnitPrice"`
	VendorOrderVersion int64            `json:"vendorOrderVersion"`
	VendorOrderNumber  int              `json:"vendorOrderNumber"`
	Problems           []ProblemSummary `json:"problems"`
	// Requester is the linked item's requester; null without an item.
	Requester *PersonRef `json:"requester"`
}

// PersonRef is a user as shown in responses.
type PersonRef struct {
	ID          bson.ObjectID `json:"id"`
	DisplayName string        `json:"displayName"`
}

// OwnerRef is an order owner; IsPurchaser comes from users.roleSnapshot.
type OwnerRef struct {
	ID          bson.ObjectID `json:"id"`
	DisplayName string        `json:"displayName"`
	IsPurchaser bool          `json:"isPurchaser"`
}

// personName is the user's display name, falling back to username, email, then the id.
func personName(u domain.User, id bson.ObjectID) string {
	for _, n := range []string{u.DisplayName, u.Username, u.Email} {
		if n != "" {
			return n
		}
	}
	return id.Hex()
}

// resolveUsers loads the users once; a failed lookup leaves the map empty so names fall back.
func (s *VendorOrders) resolveUsers(ctx context.Context, ids []bson.ObjectID) map[bson.ObjectID]domain.User {
	users, err := s.st.UsersByIDs(ctx, ids)
	if err != nil {
		return map[bson.ObjectID]domain.User{}
	}
	return users
}

func ownerRefs(owners []bson.ObjectID, users map[bson.ObjectID]domain.User) []OwnerRef {
	out := make([]OwnerRef, 0, len(owners))
	for _, id := range owners {
		u := users[id]
		out = append(out, OwnerRef{ID: id, DisplayName: personName(u, id), IsPurchaser: u.RoleSnapshot.Purchaser})
	}
	return out
}

func requesterRef(it itemInfo, users map[bson.ObjectID]domain.User) *PersonRef {
	if it.requesterID == nil {
		return nil
	}
	return &PersonRef{ID: *it.requesterID, DisplayName: personName(users[*it.requesterID], *it.requesterID)}
}

// itemInfo is what a line view shows of its item.
type itemInfo struct {
	url         string
	estimate    *domain.Money
	requesterID *bson.ObjectID
}

type productURLs map[bson.ObjectID]itemInfo

func (m productURLs) of(l *domain.VendorOrderLine) itemInfo {
	if l.ItemID == nil {
		return itemInfo{}
	}
	return m[*l.ItemID]
}

// productURLs loads the current product URL and estimate of the lines' items in one query.
func (s *VendorOrders) productURLs(ctx context.Context, lines []domain.VendorOrderLine) productURLs {
	var ids []bson.ObjectID
	for i := range lines {
		if lines[i].ItemID != nil {
			ids = append(ids, *lines[i].ItemID)
		}
	}
	out := productURLs{}
	if len(ids) == 0 {
		return out
	}
	items, err := s.st.ItemsByIDs(ctx, ids)
	if err != nil {
		return out
	}
	for _, it := range items {
		est := it.EstimatedUnitPrice
		rid := it.RequesterID
		out[it.ID] = itemInfo{url: it.ProductURL, estimate: &est, requesterID: &rid}
	}
	return out
}

// ProblemSummary is what regular users see of a problem: no delivery ids.
type ProblemSummary struct {
	ID         bson.ObjectID `json:"id"`
	Quantity   int           `json:"quantity"`
	Type       string        `json:"type"`
	Resolution *string       `json:"resolution"`
	// Version and Delivery fields are only set for purchasers, receivers and system admins.
	Version    int64          `json:"version,omitempty"`
	DeliveryID *bson.ObjectID `json:"deliveryId,omitempty"`
	Note       string         `json:"note,omitempty"`
}

// OtherTeams aggregates the lines a regular user cannot see.
type OtherTeams struct {
	Lines     int             `json:"lines"`
	TotalBase *domain.Decimal `json:"totalBase"`
}

// OrderDetail is the full order as one caller may see it.
type OrderDetail struct {
	domain.VendorOrder
	Owners           []OwnerRef         `json:"owners"`
	VendorName       string             `json:"vendorName"`
	Lines            []LineView         `json:"lines"`
	CostEntries      []domain.CostEntry `json:"costEntries"`
	Restricted       bool               `json:"restricted"`
	OtherTeams       *OtherTeams        `json:"otherTeams"`
	VisibleTotalBase *domain.Decimal    `json:"visibleTotalBase"`
	InvariantOK      *bool              `json:"invariantOk"`
	AllocationsReset bool               `json:"allocationsReset,omitempty"`
}

// OrderSummary is one row of the order list.
type OrderSummary struct {
	ID               bson.ObjectID       `json:"id"`
	Number           int                 `json:"number"`
	VendorID         bson.ObjectID       `json:"vendorId"`
	VendorName       string              `json:"vendorName"`
	Currency         string              `json:"currency"`
	Status           domain.OrderStatus  `json:"status"`
	Owners           []OwnerRef          `json:"owners"`
	ExternalOrderNo  string              `json:"externalOrderNo"`
	PlacedAt         any                 `json:"placedAt"`
	ExpectedDelivery string              `json:"expectedDeliveryDate"`
	LineCount        int                 `json:"lineCount"`
	TeamIDs          []bson.ObjectID     `json:"teamIds"`
	NetBase          *domain.Decimal     `json:"netBase"`
	Provisional      bool                `json:"provisional"`
	Incomplete       []domain.Incomplete `json:"incomplete"`
	ReceivingState   *string             `json:"receivingState"`
	AccountingState  *string             `json:"accountingState"`
	Completed        *bool               `json:"completed"`
	Restricted       bool                `json:"restricted"`
	CreatedAt        any                 `json:"createdAt"`
	Version          int64               `json:"version"`
}

func (s *VendorOrders) vendorName(ctx context.Context, id bson.ObjectID) string {
	v, err := s.st.GetVendor(ctx, id)
	if err != nil {
		return ""
	}
	return v.Name
}

func lineSummaryLabel(l *domain.VendorOrderLine) string {
	return "#" + strconv.Itoa(l.LineNo) + " " + l.Name
}

// detail builds the order as the actor may see it; nil with ErrNotFound when a
// regular user sees no line at all.
func (s *VendorOrders) detail(ctx context.Context, actor authz.Actor, o *domain.VendorOrder) (*OrderDetail, error) {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	entries, err := s.st.CostEntriesByOrder(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	ids := make([]bson.ObjectID, len(lines))
	for i := range lines {
		ids[i] = lines[i].ID
	}
	problems, err := s.st.ActiveProblemsByLines(ctx, ids)
	if err != nil {
		return nil, err
	}
	acc := s.access(ctx, actor)
	priv := privileged(actor)
	d := &OrderDetail{VendorOrder: *o, VendorName: s.vendorName(ctx, o.VendorID), Lines: []LineView{}, CostEntries: []domain.CostEntry{}}
	urls := s.productURLs(ctx, lines)
	// One user lookup covers the owners and the requesters of visible lines.
	userIDs := append([]bson.ObjectID{}, ownerIDs(o)...)
	for i := range lines {
		if acc.sees(&lines[i]) {
			if r := urls.of(&lines[i]).requesterID; r != nil {
				userIDs = append(userIDs, *r)
			}
		}
	}
	users := s.resolveUsers(ctx, userIDs)
	d.Owners = ownerRefs(ownerIDs(o), users)
	visible := map[bson.ObjectID]bool{}
	hidden := 0
	var hiddenTotal, visTotal decimal.Decimal
	hiddenKnown, visKnown := true, true
	for i := range lines {
		l := lines[i]
		if !acc.sees(&l) {
			hidden++
			if l.TotalBase == nil {
				hiddenKnown = false
			} else {
				hiddenTotal = hiddenTotal.Add(l.TotalBase.Decimal)
			}
			continue
		}
		visible[l.ID] = true
		if l.TotalBase == nil {
			visKnown = false
		} else {
			visTotal = visTotal.Add(l.TotalBase.Decimal)
		}
		lv := LineView{VendorOrderLine: l, ProductURL: urls.of(&l).url, EstimatedUnitPrice: urls.of(&l).estimate, VendorOrderVersion: o.Version, VendorOrderNumber: o.Number, Problems: []ProblemSummary{}, Requester: requesterRef(urls.of(&l), users)}
		for _, p := range problems {
			if p.VendorOrderLineID != l.ID {
				continue
			}
			ps := ProblemSummary{ID: p.ID, Quantity: p.Quantity, Type: p.Type}
			if p.Resolution != nil {
				a := p.Resolution.Action
				ps.Resolution = &a
			}
			if priv {
				ps.Version, ps.Note = p.Version, p.Note
				if p.DeliveryMatchID != nil {
					if m, err := s.st.GetMatch(ctx, *p.DeliveryMatchID); err == nil {
						ps.DeliveryID = &m.DeliveryID
					}
				}
			}
			lv.Problems = append(lv.Problems, ps)
		}
		d.Lines = append(d.Lines, lv)
	}
	if !priv {
		if len(d.Lines) == 0 {
			return nil, ErrNotFound
		}
		d.Restricted = true
		// Order-level money is limited to what is allocated to visible lines.
		d.ChargedAmountBase = nil
		d.PaymentNote = ""
		d.Totals = domain.OrderTotals{Provisional: o.Totals.Provisional, Incomplete: o.Totals.Incomplete}
		d.TeamIDs, d.BatchIDs = []bson.ObjectID{}, []bson.ObjectID{}
		seenT, seenB := map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}
		for _, lv := range d.Lines {
			seenT[lv.TeamID] = true
			if lv.BatchID != nil {
				seenB[*lv.BatchID] = true
			}
		}
		d.TeamIDs, d.BatchIDs = sortedIDs(seenT), sortedIDs(seenB)
		if visKnown {
			d.VisibleTotalBase = &domain.Decimal{Decimal: visTotal}
		}
		if hidden > 0 {
			ot := &OtherTeams{Lines: hidden}
			if hiddenKnown {
				ot.TotalBase = &domain.Decimal{Decimal: hiddenTotal}
			}
			d.OtherTeams = ot
		}
		// Restricted users see no cost entries; their lines carry the allocated amounts.
		return d, nil
	}
	d.CostEntries = append(d.CostEntries, entries...)
	if o.Totals.NetBase != nil {
		sum := decimal.Zero
		ok := true
		for _, l := range lines {
			if l.TotalBase == nil {
				ok = false
				break
			}
			sum = sum.Add(l.TotalBase.Decimal)
		}
		holds := ok && sum.Equal(o.Totals.NetBase.Decimal)
		d.InvariantOK = &holds
	}
	return d, nil
}

func (s *VendorOrders) loadOrder(ctx context.Context, id bson.ObjectID) (*domain.VendorOrder, error) {
	o, err := s.st.GetVendorOrder(ctx, id)
	if err != nil {
		return nil, mapStore(err)
	}
	return o, nil
}

// Get returns one order as the actor may see it.
func (s *VendorOrders) Get(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*OrderDetail, error) {
	o, err := s.loadOrder(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.detail(ctx, actor, o)
}

// ListInput filters the order list.
type ListOrdersInput struct {
	Status     domain.OrderStatus
	VendorID   bson.ObjectID
	TeamID     bson.ObjectID
	OwnerID    bson.ObjectID // only orders owned by this user
	Completed  *bool
	Receiving  string
	Accounting string
	Query      string
	Cursor     bson.ObjectID
	Limit      int
}

type OrderPage struct {
	Items      []OrderSummary
	NextCursor *bson.ObjectID
}

func (s *VendorOrders) summary(ctx context.Context, actor authz.Actor, acc *lineAccess, o *domain.VendorOrder, names map[bson.ObjectID]string, users map[bson.ObjectID]domain.User) (*OrderSummary, error) {
	lines, err := s.st.LinesByOrder(ctx, o.ID)
	if err != nil {
		return nil, err
	}
	visible := 0
	teams := map[bson.ObjectID]bool{}
	for i := range lines {
		if acc.sees(&lines[i]) {
			visible++
			teams[lines[i].TeamID] = true
		}
	}
	priv := privileged(actor)
	if !priv && visible == 0 {
		return nil, ErrNotFound
	}
	name, ok := names[o.VendorID]
	if !ok {
		name = s.vendorName(ctx, o.VendorID)
		names[o.VendorID] = name
	}
	sm := &OrderSummary{
		ID: o.ID, Number: o.Number, VendorID: o.VendorID, VendorName: name, Currency: o.Currency, Status: o.Status,
		Owners: ownerRefs(ownerIDs(o), users), ExternalOrderNo: o.ExternalOrderNo, ExpectedDelivery: o.ExpectedDelivery, LineCount: visible, TeamIDs: sortedIDs(teams),
		Provisional: o.Totals.Provisional, Incomplete: o.Totals.Incomplete,
		ReceivingState: o.ReceivingState, AccountingState: o.AccountingState, Completed: o.Completed, Restricted: !priv, CreatedAt: o.CreatedAt, Version: o.Version,
	}
	if o.PlacedAt != nil {
		sm.PlacedAt = *o.PlacedAt
	}
	if priv {
		sm.NetBase = o.Totals.NetBase
	}
	return sm, nil
}

// List returns the orders the actor can see, newest first. Visibility depends
// on lines, so rows are filtered after fetching and the scan continues until
// the page is full.
func (s *VendorOrders) List(ctx context.Context, actor authz.Actor, in ListOrdersInput) (*OrderPage, error) {
	limit := in.Limit
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	f := store.OrderFilter{Status: in.Status, VendorID: in.VendorID, TeamID: in.TeamID, OwnerID: in.OwnerID, Completed: in.Completed, Receiving: in.Receiving, Accounting: in.Accounting, After: in.Cursor}
	if q := strings.TrimSpace(in.Query); q != "" {
		f.ExtNo = q
		if n, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(q), "VO-")); err == nil {
			f.Number = n
		}
	}
	acc := s.access(ctx, actor)
	names := map[bson.ObjectID]string{}
	page := &OrderPage{Items: []OrderSummary{}}
	for {
		rows, err := s.st.ListVendorOrders(ctx, f, int64(limit)*2)
		if err != nil {
			return nil, err
		}
		var ownerIDsAll []bson.ObjectID
		for i := range rows {
			ownerIDsAll = append(ownerIDsAll, ownerIDs(&rows[i])...)
		}
		users := s.resolveUsers(ctx, ownerIDsAll)
		for i := range rows {
			sm, err := s.summary(ctx, actor, acc, &rows[i], names, users)
			if errors.Is(err, ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if len(page.Items) == limit {
				last := page.Items[len(page.Items)-1].ID
				page.NextCursor = &last
				return page, nil
			}
			page.Items = append(page.Items, *sm)
		}
		if len(rows) < limit*2 {
			return page, nil
		}
		f.After = rows[len(rows)-1].ID
	}
}

// ---- queue ----

// QueueItem is an approved item with quantity still to purchase.
type QueueItem struct {
	PurchaserItem
	PlannedQuantity    int    `json:"plannedQuantity"`
	ToPurchaseQuantity int    `json:"toPurchaseQuantity"`
	OrderedQuantity    int    `json:"orderedQuantity"`
	ReceivedQuantity   int    `json:"receivedQuantity"`
	TeamName           string `json:"teamName"`
	BatchNumber        int    `json:"batchNumber"`
	BatchTitle         string `json:"batchTitle"`
	DraftQuantity      int    `json:"draftQuantity"`
}

// QueueGroup is the queue entries of one vendor (VendorID nil: "other").
type QueueGroup struct {
	VendorID   *bson.ObjectID  `json:"vendorId"`
	VendorName string          `json:"vendorName"`
	TeamIDs    []bson.ObjectID `json:"teamIds"`
	Items      []QueueItem     `json:"items"`
}

type QueueFilter struct{ VendorID, TeamID, BatchID bson.ObjectID }

// Queue is the purchasing overview (spec §16.2): purchasers only.
func (s *VendorOrders) Queue(ctx context.Context, actor authz.Actor, f QueueFilter) ([]QueueGroup, error) {
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	items, err := s.st.ItemsToPurchase(ctx)
	if err != nil {
		return nil, err
	}
	vendors, err := s.st.ListVendors(ctx, false)
	if err != nil {
		return nil, err
	}
	teams, batches := map[bson.ObjectID]string{}, map[bson.ObjectID]*domain.Batch{}
	groups := map[string]*QueueGroup{}
	var keys []string
	for _, it := range items {
		// An item with only a vendor name (the "other" vendor) joins the vendor
		// whose name or alias it matches.
		if it.VendorID == nil {
			if key := domain.VendorKey(it.VendorName); key != "" {
				for _, v := range vendors {
					if v.NameKey == key || containsKey(v.AliasKeys, key) {
						id := v.ID
						it.VendorID = &id
						break
					}
				}
			}
		}
		if !f.VendorID.IsZero() && (it.VendorID == nil || *it.VendorID != f.VendorID) {
			continue
		}
		if !f.TeamID.IsZero() && it.TeamID != f.TeamID {
			continue
		}
		if !f.BatchID.IsZero() && it.BatchID != f.BatchID {
			continue
		}
		b, ok := batches[it.BatchID]
		if !ok {
			if b, err = s.st.GetBatch(ctx, it.BatchID); err != nil {
				continue
			}
			batches[it.BatchID] = b
		}
		if b.ReviewConfirmation == nil || b.ReviewConfirmation.PurchaseOutside {
			continue
		}
		tn, ok := teams[it.TeamID]
		if !ok {
			if t, err := s.st.GetTeam(ctx, it.TeamID); err == nil {
				tn = t.Name
			}
			teams[it.TeamID] = tn
		}
		key := ""
		if it.VendorID != nil {
			key = it.VendorID.Hex()
		}
		g, ok := groups[key]
		if !ok {
			g = &QueueGroup{VendorID: it.VendorID, Items: []QueueItem{}, TeamIDs: []bson.ObjectID{}}
			if it.VendorID != nil {
				g.VendorName = s.vendorName(ctx, *it.VendorID)
			}
			groups[key] = g
			keys = append(keys, key)
		}
		g.Items = append(g.Items, QueueItem{PurchaserItem: purchaserItem(&it), PlannedQuantity: it.PlannedQuantity,
			ToPurchaseQuantity: it.ToPurchaseQuantity, OrderedQuantity: it.OrderedQuantity, ReceivedQuantity: it.ReceivedQuantity, TeamName: tn, BatchNumber: b.Number, BatchTitle: b.Title,
			DraftQuantity: it.PlannedQuantity - it.OrderedQuantity})
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := groups[keys[i]], groups[keys[j]]
		if (a.VendorID == nil) != (b.VendorID == nil) {
			return a.VendorID != nil // "other" last
		}
		return strings.ToLower(a.VendorName) < strings.ToLower(b.VendorName)
	})
	out := make([]QueueGroup, 0, len(keys))
	for _, k := range keys {
		g := groups[k]
		sort.SliceStable(g.Items, func(i, j int) bool {
			if g.Items[i].VendorName != g.Items[j].VendorName {
				return strings.ToLower(g.Items[i].VendorName) < strings.ToLower(g.Items[j].VendorName)
			}
			return g.Items[i].ID.Hex() < g.Items[j].ID.Hex()
		})
		seen := map[bson.ObjectID]bool{}
		for _, it := range g.Items {
			seen[it.TeamID] = true
		}
		g.TeamIDs = sortedIDs(seen)
		out = append(out, *g)
	}
	return out, nil
}

// LinesToClose lists lines awaiting a manual close decision (purchasers and
// system admins read).
func (s *VendorOrders) LinesToClose(ctx context.Context, actor authz.Actor) ([]LineView, error) {
	if !actor.IsPurchaser && !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	lines, err := s.st.LinesToClose(ctx)
	if err != nil {
		return nil, err
	}
	urls := s.productURLs(ctx, lines)
	var rids []bson.ObjectID
	for i := range lines {
		if r := urls.of(&lines[i]).requesterID; r != nil {
			rids = append(rids, *r)
		}
	}
	users := s.resolveUsers(ctx, rids)
	orders := map[bson.ObjectID]*domain.VendorOrder{}
	out := []LineView{}
	for _, l := range lines {
		o, ok := orders[l.VendorOrderID]
		if !ok {
			if o, err = s.st.GetVendorOrder(ctx, l.VendorOrderID); err != nil {
				continue
			}
			orders[l.VendorOrderID] = o
		}
		out = append(out, LineView{VendorOrderLine: l, ProductURL: urls.of(&l).url, EstimatedUnitPrice: urls.of(&l).estimate, VendorOrderVersion: o.Version, VendorOrderNumber: o.Number, Problems: []ProblemSummary{}, Requester: requesterRef(urls.of(&l), users)})
	}
	return out, nil
}

// ---- item summaries (batch Purchasing tab) ----

// LinkedLine is the summary of a linked line shown with an item.
type LinkedLine struct {
	ID                bson.ObjectID      `json:"id"`
	VendorOrderID     bson.ObjectID      `json:"vendorOrderId"`
	VendorOrderNumber int                `json:"vendorOrderNumber"`
	OrderStatus       domain.OrderStatus `json:"orderStatus"`
	Status            domain.LineStatus  `json:"status"`
	Quantity          int                `json:"quantity"`
	ReceivedQuantity  int                `json:"receivedQuantity"`
}

// LinkedLines summarises the lines linked to each item of a batch (the
// caller can read the batch, so every linked line is visible to them).
func linkedLines(ctx context.Context, st *store.Store, itemIDs []bson.ObjectID) (map[bson.ObjectID][]LinkedLine, error) {
	out := map[bson.ObjectID][]LinkedLine{}
	orders := map[bson.ObjectID]*domain.VendorOrder{}
	for _, id := range itemIDs {
		lines, err := st.LinesByItem(ctx, id)
		if err != nil {
			return nil, err
		}
		for _, l := range lines {
			o, ok := orders[l.VendorOrderID]
			if !ok {
				if o, err = st.GetVendorOrder(ctx, l.VendorOrderID); err != nil {
					continue
				}
				orders[l.VendorOrderID] = o
			}
			out[id] = append(out[id], LinkedLine{ID: l.ID, VendorOrderID: o.ID, VendorOrderNumber: o.Number, OrderStatus: o.Status,
				Status: l.Status, Quantity: l.Quantity, ReceivedQuantity: l.ReceivedQty})
		}
	}
	return out, nil
}

// ownerIDs is the order's owners, never nil (older rows may lack the field).
func ownerIDs(o *domain.VendorOrder) []bson.ObjectID {
	if o.OwnerIDs == nil {
		return []bson.ObjectID{}
	}
	return o.OwnerIDs
}
