package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// VendorTransactions implements external orders (spec §10.3, §11): one
// purchase from a vendor that bundles team orders, possibly of several
// teams. Every write needs the purchaser role on every involved batch, and
// recalculates costs in the same transaction.
type VendorTransactions struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
}

func NewVendorTransactions(st *store.Store, a *audit.Log, b *Batches) *VendorTransactions {
	return &VendorTransactions{st: st, audit: a, batches: b}
}

const (
	maxSharedCosts = 50
	maxNoteLen     = 500
	maxPaymentNote = 2000
)

// ---- graph of orders, batches and teams ----

type txGraph struct {
	orders  []domain.Order // in transaction order
	batches map[bson.ObjectID]*domain.Batch
	teams   map[bson.ObjectID]*domain.Team
}

// graph loads the orders (in the given order) with their batches and teams.
// A missing order or batch is ErrNotFound.
func (s *VendorTransactions) graph(ctx context.Context, orderIDs []bson.ObjectID) (*txGraph, error) {
	found, err := s.st.OrdersByIDs(ctx, orderIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[bson.ObjectID]domain.Order, len(found))
	for _, o := range found {
		byID[o.ID] = o
	}
	g := &txGraph{batches: map[bson.ObjectID]*domain.Batch{}, teams: map[bson.ObjectID]*domain.Team{}}
	for _, id := range orderIDs {
		o, ok := byID[id]
		if !ok {
			return nil, ErrNotFound
		}
		g.orders = append(g.orders, o)
		if _, ok := g.batches[o.BatchID]; !ok {
			b, err := s.st.GetBatch(ctx, o.BatchID)
			if err != nil {
				return nil, mapStore(err)
			}
			g.batches[b.ID] = b
		}
		if _, ok := g.teams[o.TeamID]; !ok {
			t, err := s.st.GetTeam(ctx, o.TeamID)
			if err != nil {
				return nil, mapStore(err)
			}
			g.teams[t.ID] = t
		}
	}
	return g, nil
}

// batchOrder lists the distinct batches in order of first appearance.
func (g *txGraph) batchOrder() []*domain.Batch {
	var out []*domain.Batch
	seen := map[bson.ObjectID]bool{}
	for _, o := range g.orders {
		if !seen[o.BatchID] {
			seen[o.BatchID] = true
			out = append(out, g.batches[o.BatchID])
		}
	}
	return out
}

func (g *txGraph) teamIDs() []bson.ObjectID {
	var out []bson.ObjectID
	seen := map[bson.ObjectID]bool{}
	for _, o := range g.orders {
		if !seen[o.TeamID] {
			seen[o.TeamID] = true
			out = append(out, o.TeamID)
		}
	}
	return out
}

func (g *txGraph) canRead(actor authz.Actor, o domain.Order) bool {
	b, t := g.batches[o.BatchID], g.teams[o.TeamID]
	return actor.CanReadBatch(t.ID, t.Visibility, b.VisibilityOverride)
}

func (g *txGraph) anyReadable(actor authz.Actor) bool {
	for _, o := range g.orders {
		if g.canRead(actor, o) {
			return true
		}
	}
	return false
}

// authorizeWrite applies spec §8.3: the actor must be able to read at least
// one order (else 404, nothing is revealed) and be purchaser of every
// involved batch (else 403); archived teams are read-only.
func (g *txGraph) authorizeWrite(actor authz.Actor) error {
	if !g.anyReadable(actor) {
		return ErrNotFound
	}
	var refs []authz.BatchRef
	for _, b := range g.batchOrder() {
		refs = append(refs, authz.BatchRef{TeamID: b.TeamID, Assignments: authzAssignments(b.Assignments)})
	}
	if !actor.HasBatchRoleOnAll(refs, authz.BatchPurchaser) {
		return ErrForbidden
	}
	for _, t := range g.teams {
		if t.Archived {
			return Rule("team_archived", "Archived teams are read-only.")
		}
	}
	return nil
}

// txChange is an audit change that applies to all batches of the
// transaction, or only to one (batch non-zero).
type txChange struct {
	domain.AuditChange
	batch bson.ObjectID
}

func wholeChange(field string, from, to any) txChange {
	return txChange{AuditChange: domain.AuditChange{Field: field, From: from, To: to}}
}

// events writes one transaction event per involved batch, so that each
// batch's timeline shows what happened to the external order.
func (s *VendorTransactions) txEvents(actor string, g *txGraph, tx *domain.VendorTransaction, action string, changes []txChange) []domain.AuditEvent {
	var evs []domain.AuditEvent
	for _, b := range g.batchOrder() {
		var cs []domain.AuditChange
		for _, c := range changes {
			if c.batch.IsZero() || c.batch == b.ID {
				cs = append(cs, c.AuditChange)
			}
		}
		evs = append(evs, domain.AuditEvent{
			Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectType: "vendor_transaction", ObjectID: tx.ID.Hex(),
			Action: action, Changes: cs,
		})
	}
	return evs
}

// ---- view ----

// OrderDetail is a readable order of a transaction with its item lines.
type OrderDetail struct {
	Order domain.Order  `json:"order"`
	Items []domain.Item `json:"items"`
}

// VendorTransactionView is a transaction as shown to one viewer. Orders the
// viewer cannot read are not listed (and their ids, teams, batches and
// allocations are omitted); only their number and base total are given
// (spec §8.2).
type VendorTransactionView struct {
	domain.VendorTransaction
	Orders                []OrderDetail  `json:"orders"`
	HiddenOrderCount      int            `json:"hiddenOrderCount"`
	HiddenOrdersTotalBase domain.Decimal `json:"hiddenOrdersTotalBase"`
}

func (s *VendorTransactions) view(ctx context.Context, actor authz.Actor, tx *domain.VendorTransaction) (*VendorTransactionView, error) {
	g, err := s.graph(ctx, tx.OrderIDs)
	if err != nil {
		return nil, err
	}
	return s.viewFor(ctx, actor, tx, g)
}

func (s *VendorTransactions) viewFor(ctx context.Context, actor authz.Actor, tx *domain.VendorTransaction, g *txGraph) (*VendorTransactionView, error) {
	v := &VendorTransactionView{VendorTransaction: *tx, Orders: []OrderDetail{}}
	visible := map[bson.ObjectID]bool{}
	var itemIDs []bson.ObjectID
	for _, o := range g.orders {
		if g.canRead(actor, o) {
			visible[o.ID] = true
			itemIDs = append(itemIDs, o.ItemIDs...)
		}
	}
	items, err := s.st.ItemsByIDs(ctx, itemIDs)
	if err != nil {
		return nil, err
	}
	itemByID := make(map[bson.ObjectID]domain.Item, len(items))
	for _, it := range items {
		itemByID[it.ID] = it
	}
	v.OrderIDs, v.TeamIDs, v.BatchIDs, v.Allocations = []bson.ObjectID{}, []bson.ObjectID{}, []bson.ObjectID{}, []domain.Allocation{}
	seenTeam, seenBatch := map[bson.ObjectID]bool{}, map[bson.ObjectID]bool{}
	for _, o := range g.orders {
		if !visible[o.ID] {
			v.HiddenOrderCount++
			v.HiddenOrdersTotalBase.Decimal = v.HiddenOrdersTotalBase.Decimal.Add(o.TotalBase.Decimal)
			continue
		}
		v.OrderIDs = append(v.OrderIDs, o.ID)
		if !seenTeam[o.TeamID] {
			seenTeam[o.TeamID] = true
			v.TeamIDs = append(v.TeamIDs, o.TeamID)
		}
		if !seenBatch[o.BatchID] {
			seenBatch[o.BatchID] = true
			v.BatchIDs = append(v.BatchIDs, o.BatchID)
		}
		d := OrderDetail{Order: o, Items: []domain.Item{}}
		for _, id := range o.ItemIDs {
			if it, ok := itemByID[id]; ok {
				d.Items = append(d.Items, it)
			}
		}
		v.Orders = append(v.Orders, d)
	}
	for _, a := range tx.Allocations {
		if visible[a.OrderID] {
			v.Allocations = append(v.Allocations, a)
		}
	}
	return v, nil
}

// Get returns a transaction to anyone who can read at least one of its orders.
func (s *VendorTransactions) Get(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*VendorTransactionView, error) {
	tx, err := s.st.GetVendorTransaction(ctx, id)
	if err != nil {
		return nil, mapStore(err)
	}
	g, err := s.graph(ctx, tx.OrderIDs)
	if err != nil {
		return nil, err
	}
	if !g.anyReadable(actor) {
		return nil, ErrNotFound
	}
	return s.viewFor(ctx, actor, tx, g)
}

// ---- create ----

type CreateVendorTransactionInput struct {
	OrderIDs        []bson.ObjectID
	Currency        string
	Vendor          string // defaults to the orders' vendor when they all share one
	ExternalOrderNo string
}

// Create makes a draft external order from draft team orders (spec §10.3).
func (s *VendorTransactions) Create(ctx context.Context, actor authz.Actor, in CreateVendorTransactionInput) (*VendorTransactionView, error) {
	if err := uniqueIDs("orderIds", in.OrderIDs, 1000); err != nil {
		return nil, err
	}
	g, err := s.graph(ctx, in.OrderIDs)
	if err != nil {
		return nil, err
	}
	if err := g.authorizeWrite(actor); err != nil {
		return nil, err
	}
	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if !contains(s.batches.supported, currency) {
		return nil, Invalid("currency", "unsupported currency")
	}
	ext := strings.TrimSpace(in.ExternalOrderNo)
	if utf8.RuneCountInString(ext) > maxVendorLen {
		return nil, Invalid("externalOrderNo", "at most 200 characters")
	}
	vendor := strings.TrimSpace(in.Vendor)
	if vendor == "" {
		vendor = g.orders[0].Vendor
		for _, o := range g.orders {
			if o.Vendor != vendor {
				return nil, Invalid("vendor", "required: the orders have different vendors")
			}
		}
	}
	if vendor, err = validVendor(vendor); err != nil {
		return nil, err
	}
	for _, o := range g.orders {
		if o.Status != domain.OrderDraft || o.VendorTransactionID != nil {
			return nil, Rule("order_not_available", "Order #%d is not a draft order outside any external order.", o.Number)
		}
	}
	for _, b := range g.batchOrder() {
		if b.Status != domain.BatchOrdering {
			return nil, Rule("batch_not_ordering", "Batch #%d is not in ordering.", b.Number)
		}
	}
	tx := &domain.VendorTransaction{
		ID: bson.NewObjectID(), Vendor: vendor, ExternalOrderNo: ext, Currency: currency, OrderIDs: in.OrderIDs,
		TeamIDs: g.teamIDs(), Status: domain.OrderDraft, CreatedBy: actor.UserID,
	}
	for _, b := range g.batchOrder() {
		tx.BatchIDs = append(tx.BatchIDs, b.ID)
	}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		n, err := s.st.AttachOrdersToTransaction(ctx, in.OrderIDs, tx.ID)
		if err != nil {
			return err
		}
		if int(n) != len(in.OrderIDs) { // lost a race
			return Rule("order_not_available", "Some orders are no longer available.")
		}
		tx.SharedCosts, tx.Allocations = nil, nil
		if _, err := s.recalc(ctx, recalcInput{tx: tx}); err != nil {
			return err
		}
		if err := s.st.InsertVendorTransaction(ctx, tx); err != nil {
			return err
		}
		return s.audit.Record(ctx, s.txEvents(actor.UserID.Hex(), g, tx, "vendor_transaction.created", []txChange{
			wholeChange("status", "", string(tx.Status)),
			wholeChange("currency", "", currency),
			wholeChange("orderIds", "", hexIDs(tx.OrderIDs)),
		})...)
	})
	if err != nil {
		return nil, err
	}
	return s.viewFor(ctx, actor, tx, g)
}

// ---- update ----

// ItemPriceInput sets (or, with a nil price, clears) an item's actual unit
// price, in the transaction's currency.
type ItemPriceInput struct {
	ItemID bson.ObjectID
	Price  *domain.Money
}

// AllocationInput is one order's share of the shared costs.
type AllocationInput struct {
	OrderID bson.ObjectID
	Share   domain.Decimal
}

// VendorTxPatch lists the fields to change; unset fields stay as they are.
type VendorTxPatch struct {
	Vendor              *string
	ExternalOrderNo     *string
	PaymentNote         *string
	ExpectedDeliverySet bool
	ExpectedDelivery    *time.Time
	SharedCosts         *[]domain.SharedCost
	ChargedSet          bool
	Charged             *domain.Decimal // nil with ChargedSet clears the amount
	AllocationsSet      bool
	Allocations         []AllocationInput // nil with AllocationsSet resets to proportional
	OverrideReason      *string
	ItemPrices          []ItemPriceInput
}

func sharedCostsString(cs []domain.SharedCost) string {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i] = string(c.Type) + " " + c.Amount.String()
		if c.Note != "" {
			parts[i] += " (" + c.Note + ")"
		}
	}
	return strings.Join(parts, "; ")
}

func decPtrString(d *domain.Decimal) string {
	if d == nil {
		return ""
	}
	return d.String()
}

func allocationsString(as []domain.Allocation) string {
	parts := make([]string, len(as))
	for i, a := range as {
		parts[i] = a.OrderID.Hex() + "=" + a.ShareOfSharedCosts.String()
		if a.Overridden {
			parts[i] += "*"
		}
	}
	return strings.Join(parts, ",")
}

func timeString(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

// Update edits a transaction (purchaser of every involved batch, draft or
// placed): vendor details, shared costs, the charged amount, allocation
// overrides and actual unit prices. Costs are recalculated in the same
// transaction (spec §10.3).
func (s *VendorTransactions) Update(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, p VendorTxPatch) (*VendorTransactionView, error) {
	tx, g, err := s.loadForWrite(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if tx.Status == domain.OrderCancelled {
		return nil, Rule("vendor_transaction_cancelled", "A cancelled external order cannot be changed.")
	}
	cur := s.batches.cur
	next := *tx
	var changes []txChange
	if p.Vendor != nil {
		v, err := validVendor(*p.Vendor)
		if err != nil {
			return nil, err
		}
		if v != next.Vendor {
			changes = append(changes, wholeChange("vendor", next.Vendor, v))
			next.Vendor = v
		}
	}
	if p.ExternalOrderNo != nil {
		v := strings.TrimSpace(*p.ExternalOrderNo)
		if utf8.RuneCountInString(v) > maxVendorLen {
			return nil, Invalid("externalOrderNo", "at most 200 characters")
		}
		if v != next.ExternalOrderNo {
			changes = append(changes, wholeChange("externalOrderNo", next.ExternalOrderNo, v))
			next.ExternalOrderNo = v
		}
	}
	if p.PaymentNote != nil {
		if utf8.RuneCountInString(*p.PaymentNote) > maxPaymentNote {
			return nil, Invalid("paymentNote", "at most 2000 characters")
		}
		if *p.PaymentNote != next.PaymentNote {
			changes = append(changes, wholeChange("paymentNote", next.PaymentNote, *p.PaymentNote))
			next.PaymentNote = *p.PaymentNote
		}
	}
	if p.ExpectedDeliverySet {
		if timeString(p.ExpectedDelivery) != timeString(next.ExpectedDeliveryDate) {
			changes = append(changes, wholeChange("expectedDeliveryDate", timeString(next.ExpectedDeliveryDate), timeString(p.ExpectedDelivery)))
			next.ExpectedDeliveryDate = p.ExpectedDelivery
		}
	}
	if p.SharedCosts != nil {
		cs, err := validSharedCosts(*p.SharedCosts, cur.Digits(tx.Currency), tx.Currency)
		if err != nil {
			return nil, err
		}
		if sharedCostsString(cs) != sharedCostsString(next.SharedCosts) {
			changes = append(changes, wholeChange("sharedCosts", sharedCostsString(next.SharedCosts), sharedCostsString(cs)))
			next.SharedCosts = cs
		}
	}
	if p.ChargedSet {
		if p.Charged != nil {
			if p.Charged.IsNegative() {
				return nil, Invalid("chargedAmountBase", "must not be negative")
			}
			if n := cur.Digits(cur.Base); !domain.FitsDigits(p.Charged.Decimal, n) {
				return nil, Invalid("chargedAmountBase", fmt.Sprintf("at most %d fractional digits for %s", n, cur.Base))
			}
		}
		if decPtrString(p.Charged) != decPtrString(next.ChargedAmountBase) {
			changes = append(changes, wholeChange("chargedAmountBase", decPtrString(next.ChargedAmountBase), decPtrString(p.Charged)))
			next.ChargedAmountBase = p.Charged
		}
	}
	if p.OverrideReason != nil {
		r := strings.TrimSpace(*p.OverrideReason)
		if utf8.RuneCountInString(r) > maxNoteLen {
			return nil, Invalid("allocationOverrideReason", "at most 500 characters")
		}
		if r != next.AllocationOverrideReason {
			changes = append(changes, wholeChange("allocationOverrideReason", next.AllocationOverrideReason, r))
			next.AllocationOverrideReason = r
		}
	}

	in := recalcInput{tx: &next, mode: allocKeep}
	if p.AllocationsSet {
		in.mode = allocReset
		if p.Allocations != nil {
			if in.shares, err = validAllocations(p.Allocations, tx.OrderIDs, cur.Digits(tx.Currency)); err != nil {
				return nil, err
			}
			in.mode = allocSet
		}
	}
	if len(p.ItemPrices) > 0 {
		if in.prices, err = s.validPrices(g, tx, p.ItemPrices); err != nil {
			return nil, err
		}
	}

	var out *domain.VendorTransaction
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		fresh, err := s.st.GetVendorTransaction(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		if fresh.Version != version {
			return ErrVersionConflict
		}
		tx := next // recalc rewrites the allocations; keep each attempt independent
		in := in
		in.tx = &tx
		priceChanges, err := s.recalc(ctx, in)
		if err != nil {
			return err
		}
		all := append(append([]txChange{}, changes...), priceChanges...)
		if allocationsString(tx.Allocations) != allocationsString(fresh.Allocations) {
			all = append(all, wholeChange("allocations", allocationsString(fresh.Allocations), allocationsString(tx.Allocations)))
		}
		if len(all) == 0 {
			out = fresh
			return nil
		}
		nt, err := s.st.UpdateVendorTransaction(ctx, id, version, bson.D{
			{Key: "vendor", Value: tx.Vendor}, {Key: "externalOrderNo", Value: tx.ExternalOrderNo},
			{Key: "paymentNote", Value: tx.PaymentNote}, {Key: "expectedDeliveryDate", Value: tx.ExpectedDeliveryDate},
			{Key: "sharedCosts", Value: tx.SharedCosts}, {Key: "chargedAmountBase", Value: tx.ChargedAmountBase},
			{Key: "allocations", Value: tx.Allocations}, {Key: "allocationOverrideReason", Value: tx.AllocationOverrideReason},
		})
		if err != nil {
			return mapStore(err)
		}
		out = nt
		return s.audit.Record(ctx, s.txEvents(actor.UserID.Hex(), g, nt, "vendor_transaction.updated", all)...)
	})
	if err != nil {
		return nil, err
	}
	return s.viewFor(ctx, actor, out, g)
}

func (s *VendorTransactions) loadForWrite(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.VendorTransaction, *txGraph, error) {
	tx, err := s.st.GetVendorTransaction(ctx, id)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	g, err := s.graph(ctx, tx.OrderIDs)
	if err != nil {
		return nil, nil, err
	}
	if err := g.authorizeWrite(actor); err != nil {
		return nil, nil, err
	}
	return tx, g, nil
}

func validSharedCosts(in []domain.SharedCost, digits int, currency string) ([]domain.SharedCost, error) {
	if len(in) > maxSharedCosts {
		return nil, Invalid("sharedCosts", "at most 50 entries")
	}
	out := make([]domain.SharedCost, len(in))
	for i, c := range in {
		c.Note = strings.TrimSpace(c.Note)
		switch {
		case !c.Type.Valid():
			return nil, Invalid("sharedCosts", "unknown type at position "+itoa(i))
		case !domain.FitsDigits(c.Amount.Decimal, digits):
			return nil, Invalid("sharedCosts", fmt.Sprintf("at most %d fractional digits for %s (position %d)", digits, currency, i))
		case c.Type == domain.SharedDiscount && c.Amount.IsPositive():
			return nil, Invalid("sharedCosts", "a discount must not be positive (position "+itoa(i)+")")
		case utf8.RuneCountInString(c.Note) > maxNoteLen:
			return nil, Invalid("sharedCosts", "note too long at position "+itoa(i))
		}
		out[i] = c
	}
	return out, nil
}

// validAllocations checks that the shares name every order exactly once and
// fit the currency; the sum is checked against the shared total by the
// calculation.
func validAllocations(in []AllocationInput, orderIDs []bson.ObjectID, digits int) (map[bson.ObjectID]decimal.Decimal, error) {
	want := map[bson.ObjectID]bool{}
	for _, id := range orderIDs {
		want[id] = true
	}
	out := map[bson.ObjectID]decimal.Decimal{}
	for _, a := range in {
		if !want[a.OrderID] {
			return nil, Invalid("allocations", a.OrderID.Hex()+" is not an order of this external order")
		}
		if _, dup := out[a.OrderID]; dup {
			return nil, Invalid("allocations", "duplicate order "+a.OrderID.Hex())
		}
		if !domain.FitsDigits(a.Share.Decimal, digits) {
			return nil, Invalid("allocations", fmt.Sprintf("at most %d fractional digits", digits))
		}
		out[a.OrderID] = a.Share.Decimal
	}
	if len(out) != len(orderIDs) {
		return nil, Invalid("allocations", "every order needs exactly one allocation")
	}
	return out, nil
}

func (s *VendorTransactions) validPrices(g *txGraph, tx *domain.VendorTransaction, in []ItemPriceInput) (map[bson.ObjectID]*domain.Money, error) {
	member := map[bson.ObjectID]bson.ObjectID{} // item -> batch
	for _, o := range g.orders {
		for _, id := range o.ItemIDs {
			member[id] = o.BatchID
		}
	}
	digits := s.batches.cur.Digits(tx.Currency)
	out := map[bson.ObjectID]*domain.Money{}
	for _, p := range in {
		if _, ok := member[p.ItemID]; !ok {
			return nil, Invalid("itemPrices", p.ItemID.Hex()+" is not an item of this external order")
		}
		if _, dup := out[p.ItemID]; dup {
			return nil, Invalid("itemPrices", "duplicate item "+p.ItemID.Hex())
		}
		if p.Price != nil {
			switch {
			case p.Price.Currency != tx.Currency:
				return nil, Invalid("itemPrices", "the price currency must be "+tx.Currency)
			case p.Price.Amount.IsNegative():
				return nil, Invalid("itemPrices", "prices must not be negative")
			case !domain.FitsDigits(p.Price.Amount.Decimal, digits):
				return nil, Invalid("itemPrices", fmt.Sprintf("at most %d fractional digits for %s", digits, tx.Currency))
			}
		}
		out[p.ItemID] = p.Price
	}
	return out, nil
}

// ---- cost recalculation ----

type allocMode int

const (
	allocKeep  allocMode = iota // keep manual allocations, refresh proportional ones
	allocReset                  // back to proportional
	allocSet                    // apply `shares`
)

type recalcInput struct {
	tx     *domain.VendorTransaction // next state; Allocations and the override reason are rewritten
	prices map[bson.ObjectID]*domain.Money
	mode   allocMode
	shares map[bson.ObjectID]decimal.Decimal
}

func moneyString(m *domain.Money) string {
	if m == nil {
		return ""
	}
	return m.Amount.String() + " " + m.Currency
}

func sameDecPtr(a, b *domain.Decimal) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(b.Decimal)
}

// recalc runs spec §11 for the transaction inside the caller's database
// transaction: it applies the new actual prices, recomputes the allocation
// and every base amount, writes the changed order and item documents, and
// stores the allocation on in.tx (the caller writes the transaction itself).
// It returns the item price changes for the audit log.
func (s *VendorTransactions) recalc(ctx context.Context, in recalcInput) ([]txChange, error) {
	tx := in.tx
	found, err := s.st.OrdersByIDs(ctx, tx.OrderIDs)
	if err != nil {
		return nil, err
	}
	orders := make(map[bson.ObjectID]domain.Order, len(found))
	var itemIDs []bson.ObjectID
	for _, o := range found {
		orders[o.ID] = o
		itemIDs = append(itemIDs, o.ItemIDs...)
	}
	itemList, err := s.st.ItemsByIDs(ctx, itemIDs)
	if err != nil {
		return nil, err
	}
	items := make(map[bson.ObjectID]domain.Item, len(itemList))
	for _, it := range itemList {
		items[it.ID] = it
	}
	adj, err := s.st.AdjustmentTotals(ctx, tx.OrderIDs)
	if err != nil {
		return nil, err
	}
	var rate *decimal.Decimal
	if len(tx.TeamIDs) > 0 {
		team, err := s.st.GetTeam(ctx, tx.TeamIDs[0])
		if err != nil {
			return nil, mapStore(err)
		}
		for _, r := range team.ReferenceRates {
			if r.Currency == tx.Currency {
				d := r.RateToBase.Decimal
				rate = &d
			}
		}
	}

	var changes []txChange
	priceChanged := map[bson.ObjectID]bool{}
	for id, price := range in.prices {
		it := items[id]
		if moneyString(it.ActualUnitPrice) != moneyString(price) {
			priceChanged[id] = true
			changes = append(changes, txChange{
				AuditChange: domain.AuditChange{Field: "items." + id.Hex() + ".actualUnitPrice", From: moneyString(it.ActualUnitPrice), To: moneyString(price)},
				batch:       it.BatchID,
			})
		}
		it.ActualUnitPrice = price
		items[id] = it
	}

	cur := s.batches.cur
	ci := domain.CostInput{
		Currency: tx.Currency, Digits: cur.Digits(tx.Currency), BaseCurrency: cur.Base, BaseDigits: cur.Digits(cur.Base),
		SharedTotal: tx.SharedTotal().Decimal, ReferenceRate: rate,
	}
	if tx.ChargedAmountBase != nil {
		d := tx.ChargedAmountBase.Decimal
		ci.ChargedBase = &d
	}
	for _, id := range tx.OrderIDs {
		o := orders[id]
		co := domain.CostOrder{ID: id, AdjustmentsBase: adj[id]}
		for _, iid := range o.ItemIDs {
			it := items[iid]
			ci2 := domain.CostItem{ID: iid, Quantity: it.Quantity}
			if it.ActualUnitPrice != nil {
				p := it.ActualUnitPrice.Amount.Decimal
				ci2.UnitPrice = &p
			}
			co.Items = append(co.Items, ci2)
		}
		ci.Orders = append(ci.Orders, co)
	}

	res, err := domain.CalcCosts(ci)
	if err != nil {
		return nil, costRule(err)
	}
	// Allocation: manual (any override) or proportional.
	var manual []decimal.Decimal
	flags := make([]bool, len(tx.OrderIDs))
	switch in.mode {
	case allocSet:
		anyDiff := false
		for i, id := range tx.OrderIDs {
			manual = append(manual, in.shares[id])
			flags[i] = !in.shares[id].Equal(res.Orders[i].Share)
			anyDiff = anyDiff || flags[i]
		}
		if !anyDiff {
			manual = nil
		}
	case allocKeep:
		if tx.ManualAllocation() {
			stored := map[bson.ObjectID]domain.Allocation{}
			for _, a := range tx.Allocations {
				stored[a.OrderID] = a
			}
			for i, id := range tx.OrderIDs {
				manual = append(manual, stored[id].ShareOfSharedCosts.Decimal)
				flags[i] = stored[id].Overridden
			}
		}
	}
	if manual != nil {
		if strings.TrimSpace(tx.AllocationOverrideReason) == "" {
			return nil, Rule("allocation_override_reason_required", "A reason is required when allocations are overridden.")
		}
		ci.ManualShares = manual
		if res, err = domain.CalcCosts(ci); err != nil {
			return nil, costRule(err)
		}
	} else {
		tx.AllocationOverrideReason = ""
		flags = make([]bool, len(tx.OrderIDs))
	}
	tx.Allocations = make([]domain.Allocation, len(tx.OrderIDs))
	for i, id := range tx.OrderIDs {
		tx.Allocations[i] = domain.Allocation{OrderID: id, ShareOfSharedCosts: domain.Decimal{Decimal: res.Orders[i].Share}, Overridden: flags[i]}
	}

	// Persist what changed.
	for i, id := range tx.OrderIDs {
		o, oc := orders[id], res.Orders[i]
		if o.ItemsCostBase.Equal(oc.ItemsCostBase) && o.SharedCostBase.Equal(oc.SharedCostBase) &&
			o.AdjustmentsBase.Equal(oc.AdjustmentsBase) && o.TotalBase.Equal(oc.TotalBase) && o.CostsProvisional == res.Provisional {
			continue
		}
		if err := s.st.ApplyOrderFields(ctx, id, costFields(oc, res.Provisional)); err != nil {
			return nil, mapStore(err)
		}
	}
	for _, id := range itemIDs {
		it := items[id]
		var set bson.D
		if priceChanged[id] {
			set = append(set, bson.E{Key: "actualUnitPrice", Value: in.prices[id]})
		}
		var cost *domain.Decimal
		if res.Complete {
			c := res.ItemCostBase[id]
			cost = &domain.Decimal{Decimal: c}
		}
		if !sameDecPtr(cost, it.ActualCostBase) {
			set = append(set, bson.E{Key: "actualCostBase", Value: cost})
		}
		if len(set) == 0 {
			continue
		}
		if err := s.st.ApplyItemFields(ctx, id, set); err != nil {
			return nil, mapStore(err)
		}
	}
	return changes, nil
}

func costFields(oc domain.OrderCost, provisional bool) bson.D {
	d := func(x decimal.Decimal) domain.Decimal { return domain.Decimal{Decimal: x} }
	return bson.D{
		{Key: "itemsCostBase", Value: d(oc.ItemsCostBase)}, {Key: "sharedCostBase", Value: d(oc.SharedCostBase)},
		{Key: "adjustmentsBase", Value: d(oc.AdjustmentsBase)}, {Key: "totalBase", Value: d(oc.TotalBase)},
		{Key: "costsProvisional", Value: provisional},
	}
}

func costRule(err error) error {
	switch {
	case errors.Is(err, domain.ErrAllocationSum):
		return Rule("allocation_sum_mismatch", "The allocations must add up to the total of the shared costs.")
	case errors.Is(err, domain.ErrCostBasisZero):
		return Rule("cost_basis_zero", "A charged amount cannot be spread while the priced total is zero.")
	}
	return err
}

// ---- place and cancel ----

// Place sends the external order: orders become `placed`, items `ordered`,
// and the batches' automatic transitions run, all in one transaction.
func (s *VendorTransactions) Place(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*VendorTransactionView, error) {
	tx, g, err := s.loadForWrite(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if tx.Status != domain.OrderDraft {
		return nil, Rule("vendor_transaction_not_draft", "Only a draft external order can be placed.")
	}
	for _, b := range g.batchOrder() {
		if b.Status != domain.BatchOrdering {
			return nil, Rule("batch_not_ordering", "Batch #%d is not in ordering.", b.Number)
		}
	}
	a := actor.UserID.Hex()
	var out *domain.VendorTransaction
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		now := s.batches.now()
		nt, err := s.st.UpdateVendorTransaction(ctx, id, version, bson.D{
			{Key: "status", Value: domain.OrderPlaced}, {Key: "placedAt", Value: now}, {Key: "placedBy", Value: actor.UserID},
		})
		if err != nil {
			return mapStore(err)
		}
		out = nt
		orders, err := s.st.OrdersByIDs(ctx, tx.OrderIDs)
		if err != nil {
			return err
		}
		evs := s.txEvents(a, g, nt, "vendor_transaction.placed", []txChange{
			wholeChange("status", string(domain.OrderDraft), string(domain.OrderPlaced)),
		})
		for _, o := range orders {
			if o.Status != domain.OrderDraft || o.VendorTransactionID == nil || *o.VendorTransactionID != id {
				return Rule("order_not_available", "Order #%d is no longer a draft of this external order.", o.Number)
			}
			if err := s.st.ApplyOrderFields(ctx, o.ID, bson.D{{Key: "status", Value: domain.OrderPlaced}}); err != nil {
				return mapStore(err)
			}
			evs = append(evs, orderEvent(a, g.batches[o.BatchID], &o, "order.placed",
				domain.AuditChange{Field: "status", From: string(domain.OrderDraft), To: string(domain.OrderPlaced)}))
			items, err := s.st.ItemsByIDs(ctx, o.ItemIDs)
			if err != nil {
				return err
			}
			for _, it := range items {
				to, err := domain.NextItemStatus(it.Status, domain.EvPlaceOrder, it.ReceivedQuantity)
				if err != nil {
					return ruleFromDomain(err)
				}
				if err := s.st.ApplyItemFields(ctx, it.ID, bson.D{{Key: "status", Value: to}}); err != nil {
					return mapStore(err)
				}
				evs = append(evs, itemEvent(a, g.batches[it.BatchID], &it, "item.ordered", "",
					domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)}))
			}
		}
		if err := s.audit.Record(ctx, evs...); err != nil {
			return err
		}
		for _, b := range g.batchOrder() {
			if err := s.batches.reevaluateTx(ctx, b.ID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.viewFor(ctx, actor, out, g)
}

// Cancel withdraws a draft external order and releases its team orders,
// which return to plain drafts (spec §10.3). Placed ones cannot be cancelled.
func (s *VendorTransactions) Cancel(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*VendorTransactionView, error) {
	tx, g, err := s.loadForWrite(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if tx.Status != domain.OrderDraft {
		return nil, Rule("vendor_transaction_not_draft", "Only a draft external order can be cancelled.")
	}
	var out *domain.VendorTransaction
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		nt, err := s.st.UpdateVendorTransaction(ctx, id, version, bson.D{{Key: "status", Value: domain.OrderCancelled}})
		if err != nil {
			return mapStore(err)
		}
		out = nt
		for _, oid := range tx.OrderIDs {
			set := append(costFields(domain.OrderCost{}, true), bson.E{Key: "vendorTransactionId", Value: nil})
			if err := s.st.ApplyOrderFields(ctx, oid, set); err != nil {
				return mapStore(err)
			}
		}
		for _, o := range g.orders {
			items, err := s.st.ItemsByIDs(ctx, o.ItemIDs)
			if err != nil {
				return err
			}
			for _, it := range items {
				if it.ActualUnitPrice == nil && it.ActualCostBase == nil {
					continue
				}
				if err := s.st.ApplyItemFields(ctx, it.ID, bson.D{{Key: "actualUnitPrice", Value: nil}, {Key: "actualCostBase", Value: nil}}); err != nil {
					return mapStore(err)
				}
			}
		}
		return s.audit.Record(ctx, s.txEvents(actor.UserID.Hex(), g, nt, "vendor_transaction.cancelled", []txChange{
			wholeChange("status", string(domain.OrderDraft), string(domain.OrderCancelled)),
		})...)
	})
	if err != nil {
		return nil, err
	}
	return s.viewFor(ctx, actor, out, g)
}

// refreshCosts recomputes the cost fields of a transaction's orders inside
// the caller's database transaction, for changes that do not go through
// Update (new adjustments). The stored allocation stays as it is: nothing it
// depends on changed.
func (s *VendorTransactions) refreshCosts(ctx context.Context, txID bson.ObjectID) error {
	tx, err := s.st.GetVendorTransaction(ctx, txID)
	if err != nil {
		return mapStore(err)
	}
	next := *tx
	_, err = s.recalc(ctx, recalcInput{tx: &next, mode: allocKeep})
	return err
}
