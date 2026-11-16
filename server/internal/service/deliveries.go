package service

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Deliveries serves receiving: deliveries, their lines, matches and problems
// (spec §10.4, §10.5).
type Deliveries struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
	orders  *VendorOrders
}

func NewDeliveries(st *store.Store, a *audit.Log, b *Batches, o *VendorOrders) *Deliveries {
	return &Deliveries{st: st, audit: a, batches: b, orders: o}
}

// Receiving data is visible to purchasers, receivers and system admins; for
// everyone else it does not exist (spec §8.2). Writes need purchaser or receiver.
func canWriteDeliveries(a authz.Actor) bool { return a.IsPurchaser || a.IsReceiver }

func (s *Deliveries) gate(a authz.Actor, write bool) error {
	if !privileged(a) {
		return ErrNotFound
	}
	if write && !canWriteDeliveries(a) {
		return ErrForbidden
	}
	return nil
}

// ---- views ----

// MatchView is an active match with the line it points at.
type MatchView struct {
	ID                bson.ObjectID  `json:"id"`
	VendorOrderLineID bson.ObjectID  `json:"vendorOrderLineId"`
	VendorOrderID     bson.ObjectID  `json:"vendorOrderId"`
	VendorOrderNumber int            `json:"vendorOrderNumber"`
	LineNo            int            `json:"lineNo"`
	LineName          string         `json:"lineName"`
	GoodQuantity      int            `json:"goodQuantity"`
	ProblemQuantity   int            `json:"problemQuantity"`
	ProblemID         *bson.ObjectID `json:"problemId"`
}

// DeliveryLineView is a delivery line with its active matches and the delivery
// version its writes need in If-Match.
type DeliveryLineView struct {
	domain.DeliveryLine
	DeliveryNumber  int         `json:"deliveryNumber"`
	DeliveryVersion int64       `json:"deliveryVersion"`
	ReceivedAt      string      `json:"receivedAt"`
	Source          string      `json:"source"`
	Matches         []MatchView `json:"matches"`
	MatchedGood     int         `json:"matchedGoodQuantity"`
	MatchedProblem  int         `json:"matchedProblemQuantity"`
}

// DeliveryDetail is a delivery with its lines.
type DeliveryDetail struct {
	domain.Delivery
	Lines []DeliveryLineView `json:"lines"`
}

// DeliverySummary is one row of the delivery list.
type DeliverySummary struct {
	domain.Delivery
	LineCount        int `json:"lineCount"`
	PendingLineCount int `json:"pendingLineCount"`
}

type orderCache struct {
	s      *Deliveries
	ctx    context.Context
	orders map[bson.ObjectID]*domain.VendorOrder
	lines  map[bson.ObjectID]*domain.VendorOrderLine
}

func (s *Deliveries) cache(ctx context.Context) *orderCache {
	return &orderCache{s: s, ctx: ctx, orders: map[bson.ObjectID]*domain.VendorOrder{}, lines: map[bson.ObjectID]*domain.VendorOrderLine{}}
}

func (c *orderCache) line(id bson.ObjectID) *domain.VendorOrderLine {
	if l, ok := c.lines[id]; ok {
		return l
	}
	l, err := c.s.st.GetLine(c.ctx, id)
	if err != nil {
		l = nil
	}
	c.lines[id] = l
	return l
}

func (c *orderCache) order(id bson.ObjectID) *domain.VendorOrder {
	if o, ok := c.orders[id]; ok {
		return o
	}
	o, err := c.s.st.GetVendorOrder(c.ctx, id)
	if err != nil {
		o = nil
	}
	c.orders[id] = o
	return o
}

func (s *Deliveries) lineViews(ctx context.Context, d *domain.Delivery, lines []domain.DeliveryLine, c *orderCache) ([]DeliveryLineView, error) {
	ids := make([]bson.ObjectID, len(lines))
	for i := range lines {
		ids[i] = lines[i].ID
	}
	matches, err := s.st.ActiveMatchesOfDeliveryLines(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]DeliveryLineView, 0, len(lines))
	for _, dl := range lines {
		v := DeliveryLineView{DeliveryLine: dl, DeliveryNumber: d.Number, DeliveryVersion: d.Version, ReceivedAt: d.ReceivedAt,
			Source: d.Source, Matches: []MatchView{}}
		for _, m := range matches {
			if m.DeliveryLineID != dl.ID {
				continue
			}
			mv := MatchView{ID: m.ID, VendorOrderLineID: m.VendorOrderLineID, GoodQuantity: m.GoodQuantity, ProblemQuantity: m.ProblemQuantity}
			if l := c.line(m.VendorOrderLineID); l != nil {
				mv.VendorOrderID, mv.LineNo, mv.LineName = l.VendorOrderID, l.LineNo, l.Name
				if o := c.order(l.VendorOrderID); o != nil {
					mv.VendorOrderNumber = o.Number
				}
			}
			if m.ProblemQuantity > 0 {
				if p, err := s.st.ProblemOfMatch(ctx, m.ID); err == nil {
					mv.ProblemID = &p.ID
				}
			}
			v.MatchedGood += m.GoodQuantity
			v.MatchedProblem += m.ProblemQuantity
			v.Matches = append(v.Matches, mv)
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Deliveries) detail(ctx context.Context, d *domain.Delivery) (*DeliveryDetail, error) {
	lines, err := s.st.DeliveryLinesOf(ctx, d.ID)
	if err != nil {
		return nil, err
	}
	views, err := s.lineViews(ctx, d, lines, s.cache(ctx))
	if err != nil {
		return nil, err
	}
	return &DeliveryDetail{Delivery: *d, Lines: views}, nil
}

func (s *Deliveries) loadDelivery(ctx context.Context, id bson.ObjectID) (*domain.Delivery, error) {
	d, err := s.st.GetDelivery(ctx, id)
	if err != nil {
		return nil, mapStore(err)
	}
	return d, nil
}

// Get returns one delivery.
func (s *Deliveries) Get(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*DeliveryDetail, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	d, err := s.loadDelivery(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.detail(ctx, d)
}

type ListDeliveriesInput struct {
	Voided   *bool
	From, To string
	Query    string
	Cursor   bson.ObjectID
	Limit    int
}

type DeliveryPage struct {
	Items      []DeliverySummary
	NextCursor *bson.ObjectID
}

func validDate(field, v string) error {
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return Invalid(field, "must be a date (YYYY-MM-DD)")
	}
	return nil
}

// List returns deliveries newest first.
func (s *Deliveries) List(ctx context.Context, actor authz.Actor, in ListDeliveriesInput) (*DeliveryPage, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	limit := in.Limit
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	f := store.DeliveryFilter{Voided: in.Voided, From: in.From, To: in.To, After: in.Cursor}
	for field, v := range map[string]string{"from": in.From, "to": in.To} {
		if v != "" {
			if err := validDate(field, v); err != nil {
				return nil, err
			}
		}
	}
	if q := strings.TrimSpace(in.Query); q != "" {
		f.Text = q
		if n, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(q), "DL-")); err == nil {
			f.Number = n
		}
	}
	rows, err := s.st.ListDeliveries(ctx, f, int64(limit)+1)
	if err != nil {
		return nil, err
	}
	page := &DeliveryPage{Items: []DeliverySummary{}}
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[limit-1].ID
		page.NextCursor = &last
	}
	for _, d := range rows {
		lines, err := s.st.DeliveryLinesOf(ctx, d.ID)
		if err != nil {
			return nil, err
		}
		sm := DeliverySummary{Delivery: d, LineCount: len(lines)}
		for _, l := range lines {
			if l.MatchState == domain.MatchUnmatched || l.MatchState == domain.MatchPartial {
				sm.PendingLineCount++
			}
		}
		page.Items = append(page.Items, sm)
	}
	return page, nil
}

// PendingLines is the matching worklist: lines of live deliveries that are
// unmatched or partial (default), or in the given states.
func (s *Deliveries) Lines(ctx context.Context, actor authz.Actor, states []domain.MatchState) ([]DeliveryLineView, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if len(states) == 0 {
		states = []domain.MatchState{domain.MatchUnmatched, domain.MatchPartial}
	}
	lines, err := s.st.DeliveryLinesByState(ctx, states, 500)
	if err != nil {
		return nil, err
	}
	c := s.cache(ctx)
	out := []DeliveryLineView{}
	deliveries := map[bson.ObjectID]*domain.Delivery{}
	for _, dl := range lines {
		d, ok := deliveries[dl.DeliveryID]
		if !ok {
			if d, err = s.st.GetDelivery(ctx, dl.DeliveryID); err != nil {
				continue
			}
			deliveries[dl.DeliveryID] = d
		}
		vs, err := s.lineViews(ctx, d, []domain.DeliveryLine{dl}, c)
		if err != nil {
			return nil, err
		}
		out = append(out, vs...)
	}
	return out, nil
}

// ---- candidates and suggestions ----

// Candidate is a vendor order line that could take a delivered quantity.
type Candidate struct {
	LineID            bson.ObjectID `json:"vendorOrderLineId"`
	VendorOrderID     bson.ObjectID `json:"vendorOrderId"`
	VendorOrderNumber int           `json:"vendorOrderNumber"`
	VendorName        string        `json:"vendorName"`
	PlacedAt          *time.Time    `json:"placedAt"`
	LineNo            int           `json:"lineNo"`
	Name              string        `json:"name"`
	SKU               string        `json:"sku"`
	Quantity          int           `json:"quantity"`
	ReceivedQuantity  int           `json:"receivedQuantity"`
	// Capacity is how many more units the line can take (spec §10.3 inequality).
	Capacity         int     `json:"capacity"`
	MatchedBy        string  `json:"matchedBy"` // sku | name
	Score            float64 `json:"score"`
	SuggestedGood    int     `json:"suggestedGoodQuantity"`
	SuggestedProblem int     `json:"suggestedProblemQuantity"`
}

const nameThreshold = 0.4

// candidates ranks open lines for a SKU and name: exact SKU first, then name
// similarity; older orders first within a tier (spec §10.4).
func (s *Deliveries) candidates(ctx context.Context, sku, name string) ([]Candidate, error) {
	lines, err := s.st.OpenLines(ctx)
	if err != nil {
		return nil, err
	}
	sku = strings.TrimSpace(sku)
	c := s.cache(ctx)
	vendors := map[bson.ObjectID]string{}
	var out []Candidate
	for _, l := range lines {
		capacity := l.Quantity - l.ReceivedQty - l.OpenProblemQty - l.ReturnedQty
		if capacity < 1 {
			continue
		}
		cand := Candidate{LineID: l.ID, VendorOrderID: l.VendorOrderID, LineNo: l.LineNo, Name: l.Name, SKU: l.SKU, Quantity: l.Quantity,
			ReceivedQuantity: l.ReceivedQty, Capacity: capacity}
		switch {
		case sku != "" && l.SKU != "" && strings.EqualFold(sku, strings.TrimSpace(l.SKU)):
			cand.MatchedBy, cand.Score = "sku", 1
		case name != "" && domain.NameSimilarity(name, l.Name) >= nameThreshold:
			cand.MatchedBy, cand.Score = "name", domain.NameSimilarity(name, l.Name)
		default:
			continue
		}
		o := c.order(l.VendorOrderID)
		if o == nil || o.Status != domain.OrderPlaced {
			continue
		}
		cand.VendorOrderNumber, cand.PlacedAt = o.Number, o.PlacedAt
		vn, ok := vendors[o.VendorID]
		if !ok {
			vn = s.orders.vendorName(ctx, o.VendorID)
			vendors[o.VendorID] = vn
		}
		cand.VendorName = vn
		out = append(out, cand)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.MatchedBy != b.MatchedBy {
			return a.MatchedBy == "sku"
		}
		if (a.PlacedAt == nil) != (b.PlacedAt == nil) {
			return a.PlacedAt != nil
		}
		if a.PlacedAt != nil && !a.PlacedAt.Equal(*b.PlacedAt) {
			return a.PlacedAt.Before(*b.PlacedAt)
		}
		if a.VendorOrderNumber != b.VendorOrderNumber {
			return a.VendorOrderNumber < b.VendorOrderNumber
		}
		return a.LineNo < b.LineNo
	})
	return out, nil
}

// allocate suggests how to spread good then problem units over the top tier
// of candidates, oldest order first.
func allocate(cands []Candidate, good, problem int) {
	if len(cands) == 0 {
		return
	}
	tier := cands[0].MatchedBy
	for i := range cands {
		if cands[i].MatchedBy != tier {
			break
		}
		room := cands[i].Capacity
		g := min(room, good)
		good, room = good-g, room-g
		p := min(room, problem)
		problem -= p
		cands[i].SuggestedGood, cands[i].SuggestedProblem = g, p
	}
}

// MatchCandidates serves GET /purchasing/match-candidates for a box that is
// not saved yet.
func (s *Deliveries) MatchCandidates(ctx context.Context, actor authz.Actor, sku, name string) ([]Candidate, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if !canWriteDeliveries(actor) {
		return nil, ErrForbidden
	}
	if strings.TrimSpace(sku) == "" && strings.TrimSpace(name) == "" {
		return nil, Invalid("sku", "sku or name is required")
	}
	c, err := s.candidates(ctx, sku, name)
	if c == nil {
		c = []Candidate{}
	}
	return c, err
}

// Suggestions lists candidates for a saved delivery line with a suggested
// split of what is not matched yet.
func (s *Deliveries) Suggestions(ctx context.Context, actor authz.Actor, lineID bson.ObjectID) ([]Candidate, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if !canWriteDeliveries(actor) {
		return nil, ErrForbidden
	}
	dl, err := s.st.GetDeliveryLine(ctx, lineID)
	if err != nil {
		return nil, mapStore(err)
	}
	cands, err := s.candidates(ctx, dl.SKU, dl.Name)
	if err != nil {
		return nil, err
	}
	ms, err := s.st.ActiveMatchesOfDeliveryLines(ctx, []bson.ObjectID{dl.ID})
	if err != nil {
		return nil, err
	}
	good, problem := dl.GoodQuantity, dl.ProblemQuantity
	for _, m := range ms {
		good, problem = good-m.GoodQuantity, problem-m.ProblemQuantity
	}
	allocate(cands, max(good, 0), max(problem, 0))
	if cands == nil {
		cands = []Candidate{}
	}
	return cands, nil
}

// ---- matching engine ----

// MatchInput is one wanted match of a delivery line.
type MatchInput struct {
	VendorOrderLineID bson.ObjectID
	GoodQuantity      int
	ProblemQuantity   int
}

type txState struct {
	actor    authz.Actor
	d        *domain.Delivery
	now      time.Time
	affected map[bson.ObjectID]bool // vendor order line ids whose quantities may change
	events   []domain.AuditEvent
	emits    []store.EventRecord
	teams    map[bson.ObjectID]bool
	cache    *orderCache
}

func (s *Deliveries) newState(ctx context.Context, actor authz.Actor, d *domain.Delivery) *txState {
	return &txState{actor: actor, d: d, now: s.batches.now(), affected: map[bson.ObjectID]bool{},
		teams: map[bson.ObjectID]bool{}, cache: s.cache(ctx)}
}

func (st *txState) touch(l *domain.VendorOrderLine) {
	st.affected[l.ID] = true
	st.teams[l.TeamID] = true
}

func (st *txState) lineEvent(o *domain.VendorOrder, l *domain.VendorOrderLine, action, comment string, changes ...domain.AuditChange) {
	st.events = append(st.events, domain.AuditEvent{Actor: st.actor.UserID.Hex(), TeamIDs: []bson.ObjectID{l.TeamID}, BatchID: derefID(l.BatchID),
		ObjectType: "vendor_order", ObjectID: o.ID.Hex(), Scope: "line", LineIDs: []string{l.ID.Hex()},
		Action: action, Comment: comment, Changes: changes})
}

func (st *txState) problemEvent(typ string, l *domain.VendorOrderLine, p *domain.LineProblem, undone bool) {
	st.emits = append(st.emits, store.EventRecord{Type: typ, Actor: st.actor.UserID.Hex(), TeamID: l.TeamID, BatchID: derefID(l.BatchID),
		ObjectID: p.ID.Hex(), Undone: undone})
}

func (s *Deliveries) loadLine(ctx context.Context, st *txState, id bson.ObjectID) (*domain.VendorOrderLine, *domain.VendorOrder, error) {
	l, err := s.st.GetLine(ctx, id)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	o, err := s.st.GetVendorOrder(ctx, l.VendorOrderID)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	return l, o, nil
}

func lineQuantityExceeded(l *domain.VendorOrderLine, remaining int) *RuleError {
	e := Rule("line_quantity_exceeded", "Line #%d can take only %d more.", l.LineNo, max(remaining, 0))
	e.Details = map[string]any{"vendorOrderLineId": l.ID.Hex(), "lineNo": l.LineNo, "remaining": max(remaining, 0)}
	return e
}

// applyMatches replaces a delivery line's matches by the wanted set, diffing by
// vendorOrderLineId: unchanged kept, changed voided and recreated, missing
// voided. All checks and writes happen in the caller's transaction.
func (s *Deliveries) applyMatches(ctx context.Context, st *txState, dl *domain.DeliveryLine, want []MatchInput) error {
	wantBy := map[bson.ObjectID]MatchInput{}
	sumG, sumP := 0, 0
	for _, w := range want {
		if _, dup := wantBy[w.VendorOrderLineID]; dup {
			return Invalid("matches", "each vendor order line may appear once")
		}
		if w.GoodQuantity < 0 || w.ProblemQuantity < 0 || w.GoodQuantity+w.ProblemQuantity < 1 {
			return Invalid("matches", "quantities must be non-negative and at least one unit")
		}
		wantBy[w.VendorOrderLineID] = w
		sumG, sumP = sumG+w.GoodQuantity, sumP+w.ProblemQuantity
	}
	if sumG > dl.GoodQuantity || sumP > dl.ProblemQuantity {
		return Invalid("matches", "more than the delivery line holds")
	}
	existing, err := s.st.ActiveMatchesOfDeliveryLines(ctx, []bson.ObjectID{dl.ID})
	if err != nil {
		return err
	}
	var toVoid []domain.DeliveryMatch
	kept := map[bson.ObjectID]bool{}
	for _, e := range existing {
		w, ok := wantBy[e.VendorOrderLineID]
		if ok && w.GoodQuantity == e.GoodQuantity && w.ProblemQuantity == e.ProblemQuantity {
			kept[e.VendorOrderLineID] = true
			continue
		}
		toVoid = append(toVoid, e)
	}
	var toCreate []MatchInput
	for _, w := range want {
		if !kept[w.VendorOrderLineID] {
			toCreate = append(toCreate, w)
		}
	}

	// Voiding is refused while a resolved problem or a closure depends on the match.
	var blockers []Blocker
	voidProblems := map[bson.ObjectID]*domain.LineProblem{} // match id → unresolved problem
	for _, m := range toVoid {
		l, _, err := s.loadLine(ctx, st, m.VendorOrderLineID)
		if err != nil {
			return err
		}
		if l.Closure != nil {
			blockers = append(blockers, Blocker{Type: "line_closure", ID: l.ID.Hex(), Label: lineSummaryLabel(l), ParentID: l.VendorOrderID.Hex()})
		}
		if m.ProblemQuantity > 0 {
			if p, err := s.st.ProblemOfMatch(ctx, m.ID); err == nil {
				if p.Resolution != nil {
					blockers = append(blockers, Blocker{Type: "problem", ID: p.ID.Hex(), Label: p.Type + " x" + itoa(p.Quantity), ParentID: l.VendorOrderID.Hex()})
				} else {
					voidProblems[m.ID] = p
				}
			} else if err != store.ErrNotFound {
				return err
			}
		}
	}
	if len(blockers) > 0 {
		return &BlockedError{Blockers: blockers}
	}

	// New matches: placed, unclosed lines, and the quantity inequality of §10.3.
	type check struct {
		l       *domain.VendorOrderLine
		o       *domain.VendorOrder
		newG    int
		newP    int
		removed []domain.DeliveryMatch
	}
	checks := map[bson.ObjectID]*check{}
	for _, w := range toCreate {
		l, o, err := s.loadLine(ctx, st, w.VendorOrderLineID)
		if err != nil {
			if err == ErrNotFound {
				return Invalid("matches", "unknown vendor order line")
			}
			return err
		}
		if o.Status != domain.OrderPlaced {
			return Rule("line_not_matchable", "Line #%d is not on a placed order.", l.LineNo)
		}
		if l.Closure != nil {
			return Rule("line_not_matchable", "Line #%d is closed; reopen it first.", l.LineNo)
		}
		checks[l.ID] = &check{l: l, o: o, newG: w.GoodQuantity, newP: w.ProblemQuantity}
	}
	for _, m := range toVoid {
		if c := checks[m.VendorOrderLineID]; c != nil {
			c.removed = append(c.removed, m)
		}
	}
	ids := make([]bson.ObjectID, 0, len(checks))
	for id := range checks {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].Hex() < ids[j].Hex() })
	// Touch each line first: the version bump is what makes two concurrent
	// matches to the same line conflict, so the loser re-runs and fails here (spec §10).
	for _, id := range ids {
		if err := s.st.BumpLine(ctx, id); err != nil {
			return err
		}
	}
	for _, id := range ids {
		c := checks[id]
		ms, err := s.st.ActiveMatchesByLines(ctx, []bson.ObjectID{id})
		if err != nil {
			return err
		}
		ps, err := s.st.ActiveProblemsByLines(ctx, []bson.ObjectID{id})
		if err != nil {
			return err
		}
		gone := map[bson.ObjectID]bool{}
		for _, r := range c.removed {
			gone[r.ID] = true
		}
		var remM []domain.DeliveryMatch
		for _, m := range ms {
			if !gone[m.ID] {
				remM = append(remM, m)
			}
		}
		var remP []domain.LineProblem
		for _, p := range ps {
			if p.DeliveryMatchID != nil && gone[*p.DeliveryMatchID] {
				continue
			}
			remP = append(remP, p)
		}
		q := domain.ComputeQuantities(remM, remP)
		used := q.Received + q.OpenProblem + q.Returned
		if used+c.newG+c.newP > c.l.Quantity {
			return lineQuantityExceeded(c.l, c.l.Quantity-used)
		}
	}

	// Writes.
	for _, m := range toVoid {
		l, o, err := s.loadLine(ctx, st, m.VendorOrderLineID)
		if err != nil {
			return err
		}
		if _, bumped := checks[l.ID]; !bumped {
			if err := s.st.BumpLine(ctx, l.ID); err != nil {
				return err
			}
		}
		v := domain.Void{Reason: "match changed", By: st.actor.UserID, At: st.now}
		if err := s.st.VoidMatch(ctx, m.ID, v); err != nil {
			return mapStore(err)
		}
		if p := voidProblems[m.ID]; p != nil {
			if err := s.st.VoidProblem(ctx, p.ID, v); err != nil {
				return mapStore(err)
			}
			st.problemEvent("problem.reported", l, p, true)
		}
		st.touch(l)
		st.lineEvent(o, l, "vendor_order.delivery_match_voided", "DL-"+itoa(st.d.Number),
			ch("receivedQuantity", m.GoodQuantity, 0))
	}
	for _, w := range toCreate {
		c := checks[w.VendorOrderLineID]
		m := &domain.DeliveryMatch{DeliveryLineID: dl.ID, DeliveryID: dl.DeliveryID, VendorOrderLineID: w.VendorOrderLineID,
			GoodQuantity: w.GoodQuantity, ProblemQuantity: w.ProblemQuantity, CreatedBy: st.actor.UserID}
		if err := s.st.InsertMatch(ctx, m); err != nil {
			return err
		}
		if w.ProblemQuantity > 0 {
			p := &domain.LineProblem{VendorOrderLineID: w.VendorOrderLineID, DeliveryMatchID: &m.ID, Quantity: w.ProblemQuantity,
				Type: dl.ProblemType, Note: dl.ProblemNote}
			if err := s.st.InsertProblem(ctx, p); err != nil {
				return err
			}
			st.problemEvent("problem.reported", c.l, p, false)
			st.lineEvent(c.o, c.l, "vendor_order.problem_reported", dl.ProblemNote, ch("problem", nil, p.Type+" x"+itoa(p.Quantity)))
		}
		st.touch(c.l)
		st.lineEvent(c.o, c.l, "vendor_order.delivery_matched", "DL-"+itoa(st.d.Number),
			ch("receivedQuantity", nil, w.GoodQuantity))
	}
	if len(toVoid) == 0 && len(toCreate) == 0 {
		return nil
	}
	ms, err := s.st.ActiveMatchesOfDeliveryLines(ctx, []bson.ObjectID{dl.ID})
	if err != nil {
		return err
	}
	dl.MatchState = domain.DeriveMatchState(dl, ms)
	if err := s.st.SetDeliveryLine(ctx, dl.ID, bson.D{{Key: "matchState", Value: dl.MatchState}}); err != nil {
		return mapStore(err)
	}
	st.events = append(st.events, domain.AuditEvent{Actor: st.actor.UserID.Hex(), ObjectType: "delivery", ObjectID: st.d.ID.Hex(),
		Action: "delivery.line_matched", Changes: []domain.AuditChange{ch("line #"+itoa(dl.LineNo)+" matches", len(existing), len(want))}})
	return nil
}

// finish recomputes every touched order (quantities, statuses, money, items,
// batches), then writes the audit events and notification events.
func (s *Deliveries) finish(ctx context.Context, st *txState) error {
	orderIDs := map[bson.ObjectID]bool{}
	for id := range st.affected {
		l, err := s.st.GetLine(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		orderIDs[l.VendorOrderID] = true
	}
	for _, id := range sortedIDs(orderIDs) {
		o, err := s.st.GetVendorOrder(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		if _, _, err := s.batches.recomputeOrder(ctx, o, recomputeOpts{}); err != nil {
			return err
		}
	}
	teams := sortedIDs(st.teams)
	for i := range st.events {
		if st.events[i].ObjectType == "delivery" {
			st.events[i].TeamIDs = teams
		}
	}
	if err := s.audit.Record(ctx, st.events...); err != nil {
		return err
	}
	for _, e := range st.emits {
		if err := s.st.Emit(ctx, e); err != nil {
			return err
		}
	}
	return nil
}

func (s *Deliveries) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	return s.st.WithTx(ctx, fn)
}

// ---- create ----

type DeliveryLineInput struct {
	Name, SKU       string
	GoodQuantity    int
	ProblemQuantity int
	ProblemType     string
	ProblemNote     string
	Matches         []MatchInput
}

type CreateDeliveryInput struct {
	ReceivedAt string // YYYY-MM-DD; empty: today
	Source     string
	Note       string
	Lines      []DeliveryLineInput
}

// Create registers one box, optionally matching its lines right away.
func (s *Deliveries) Create(ctx context.Context, actor authz.Actor, in CreateDeliveryInput) (*DeliveryDetail, error) {
	if err := s.gate(actor, true); err != nil {
		return nil, err
	}
	if in.ReceivedAt == "" {
		in.ReceivedAt = s.batches.now().Format("2006-01-02")
	} else if err := validDate("receivedAt", in.ReceivedAt); err != nil {
		return nil, err
	}
	if len(in.Lines) == 0 || len(in.Lines) > 200 {
		return nil, Invalid("lines", "between 1 and 200 lines are required")
	}
	for i, l := range in.Lines {
		in.Lines[i].Name, in.Lines[i].SKU = strings.TrimSpace(l.Name), strings.TrimSpace(l.SKU)
		if err := validDeliveryLine(&in.Lines[i]); err != nil {
			return nil, err
		}
	}
	var out *DeliveryDetail
	err := s.tx(ctx, func(ctx context.Context) error {
		n, err := s.st.NextCounter(ctx, "delivery")
		if err != nil {
			return mapStore(err)
		}
		d := &domain.Delivery{Number: n, ReceivedAt: in.ReceivedAt, Source: strings.TrimSpace(in.Source), Note: strings.TrimSpace(in.Note), CreatedBy: actor.UserID}
		if err := s.st.InsertDelivery(ctx, d); err != nil {
			return mapStore(err)
		}
		st := s.newState(ctx, actor, d)
		pending := false
		for i, li := range in.Lines {
			dl := &domain.DeliveryLine{DeliveryID: d.ID, LineNo: i + 1, Name: li.Name, SKU: li.SKU, GoodQuantity: li.GoodQuantity,
				ProblemQuantity: li.ProblemQuantity, ProblemType: li.ProblemType, ProblemNote: li.ProblemNote, MatchState: domain.MatchUnmatched}
			if err := s.st.InsertDeliveryLine(ctx, dl); err != nil {
				return mapStore(err)
			}
			if len(li.Matches) > 0 {
				if err := s.applyMatches(ctx, st, dl, li.Matches); err != nil {
					return err
				}
			}
			if dl.MatchState == domain.MatchUnmatched || dl.MatchState == domain.MatchPartial {
				pending = true
			}
		}
		st.events = append([]domain.AuditEvent{{Actor: actor.UserID.Hex(), ObjectType: "delivery", ObjectID: d.ID.Hex(),
			Action: "delivery.created", Changes: []domain.AuditChange{ch("lines", nil, len(in.Lines))}}}, st.events...)
		if pending {
			st.emits = append(st.emits, store.EventRecord{Type: "delivery.needs_matching", Actor: actor.UserID.Hex(), ObjectID: d.ID.Hex()})
		}
		if err := s.finish(ctx, st); err != nil {
			return err
		}
		out, err = s.detail(ctx, d)
		return err
	})
	return out, err
}

func validDeliveryLine(l *DeliveryLineInput) error {
	if l.Name == "" && l.SKU == "" {
		return Invalid("lines", "each line needs a name or a SKU")
	}
	if len(l.Name) > 300 || len(l.SKU) > 100 || len(l.ProblemNote) > 1000 {
		return Invalid("lines", "name, SKU or note too long")
	}
	if l.GoodQuantity < 0 || l.ProblemQuantity < 0 || l.GoodQuantity+l.ProblemQuantity < 1 {
		return Invalid("lines", "quantities must be non-negative and total at least one")
	}
	if l.ProblemQuantity > 0 {
		if l.ProblemType != domain.ProblemDamaged && l.ProblemType != domain.ProblemWrongItem {
			return Invalid("lines", "problemType must be damaged or wrong_item when there is a problem quantity")
		}
	} else {
		l.ProblemType, l.ProblemNote = "", ""
	}
	return nil
}

// ---- matching, no-match, void ----

// loadForWrite loads a delivery line and its live delivery and checks If-Match
// against the delivery version.
func (s *Deliveries) loadForWrite(ctx context.Context, lineID bson.ObjectID, version int64) (*domain.DeliveryLine, *domain.Delivery, error) {
	dl, err := s.st.GetDeliveryLine(ctx, lineID)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	d, err := s.loadDelivery(ctx, dl.DeliveryID)
	if err != nil {
		return nil, nil, err
	}
	if version != d.Version {
		return nil, nil, ErrVersionConflict
	}
	if d.Voided != nil {
		return nil, nil, Rule("invalid_transition", "The delivery is voided.")
	}
	return dl, d, nil
}

// SetMatches sets a delivery line's matches (PUT semantics, all or nothing).
func (s *Deliveries) SetMatches(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, want []MatchInput) (*DeliveryDetail, error) {
	if err := s.gate(actor, true); err != nil {
		return nil, err
	}
	var out *DeliveryDetail
	err := s.tx(ctx, func(ctx context.Context) error {
		dl, d, err := s.loadForWrite(ctx, lineID, version)
		if err != nil {
			return err
		}
		if dl.NoMatch != nil {
			return Rule("invalid_transition", "The line is marked as needing no match; undo that first.")
		}
		st := s.newState(ctx, actor, d)
		if err := s.applyMatches(ctx, st, dl, want); err != nil {
			return err
		}
		d, err = s.st.UpdateDelivery(ctx, d.ID, d.Version, bson.D{})
		if err != nil {
			return mapStore(err)
		}
		st.d = d
		if err := s.finish(ctx, st); err != nil {
			return err
		}
		out, err = s.detail(ctx, d)
		return err
	})
	return out, err
}

// NoMatch marks a pending delivery line as needing no match.
func (s *Deliveries) NoMatch(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, reason string) (*DeliveryDetail, error) {
	if err := s.gate(actor, true); err != nil {
		return nil, err
	}
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	return s.toggleNoMatch(ctx, actor, lineID, version, reason, true)
}

// UndoNoMatch puts a line back on the pending list.
func (s *Deliveries) UndoNoMatch(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, reason string) (*DeliveryDetail, error) {
	if err := s.gate(actor, true); err != nil {
		return nil, err
	}
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	return s.toggleNoMatch(ctx, actor, lineID, version, reason, false)
}

func (s *Deliveries) toggleNoMatch(ctx context.Context, actor authz.Actor, lineID bson.ObjectID, version int64, reason string, set bool) (*DeliveryDetail, error) {
	var out *DeliveryDetail
	err := s.tx(ctx, func(ctx context.Context) error {
		dl, d, err := s.loadForWrite(ctx, lineID, version)
		if err != nil {
			return err
		}
		ms, err := s.st.ActiveMatchesOfDeliveryLines(ctx, []bson.ObjectID{dl.ID})
		if err != nil {
			return err
		}
		action := "delivery.no_match"
		if set {
			if dl.NoMatch != nil || dl.MatchState == domain.MatchMatched {
				return Rule("invalid_transition", "Only an unmatched or partially matched line can be marked as needing no match.")
			}
			dl.NoMatch = &domain.NoMatch{Reason: reason, By: actor.UserID, At: s.batches.now()}
		} else {
			if dl.NoMatch == nil {
				return Rule("invalid_transition", "The line is not marked as needing no match.")
			}
			dl.NoMatch = nil
			action += ".undone"
		}
		dl.MatchState = domain.DeriveMatchState(dl, ms)
		if err := s.st.SetDeliveryLine(ctx, dl.ID, bson.D{{Key: "noMatch", Value: dl.NoMatch}, {Key: "matchState", Value: dl.MatchState}}); err != nil {
			return mapStore(err)
		}
		if d, err = s.st.UpdateDelivery(ctx, d.ID, d.Version, bson.D{}); err != nil {
			return mapStore(err)
		}
		if err := s.audit.Record(ctx, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "delivery", ObjectID: d.ID.Hex(),
			Action: action, Comment: reason, Changes: []domain.AuditChange{ch("line #"+itoa(dl.LineNo)+" matchState", nil, string(dl.MatchState))}}); err != nil {
			return err
		}
		out, err = s.detail(ctx, d)
		return err
	})
	return out, err
}

// Void voids a delivery with its matches and their unresolved problems.
func (s *Deliveries) Void(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*DeliveryDetail, error) {
	if err := s.gate(actor, true); err != nil {
		return nil, err
	}
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	var out *DeliveryDetail
	err = s.tx(ctx, func(ctx context.Context) error {
		d, err := s.loadDelivery(ctx, id)
		if err != nil {
			return err
		}
		if version != d.Version {
			return ErrVersionConflict
		}
		if d.Voided != nil {
			return Rule("invalid_transition", "The delivery is already voided.")
		}
		matches, err := s.st.ActiveMatchesOfDelivery(ctx, d.ID)
		if err != nil {
			return err
		}
		st := s.newState(ctx, actor, d)
		var blockers []Blocker
		problems := map[bson.ObjectID]*domain.LineProblem{}
		for _, m := range matches {
			l, _, err := s.loadLine(ctx, st, m.VendorOrderLineID)
			if err != nil {
				return err
			}
			if l.Closure != nil {
				blockers = append(blockers, Blocker{Type: "line_closure", ID: l.ID.Hex(), Label: lineSummaryLabel(l), ParentID: l.VendorOrderID.Hex()})
			}
			if m.ProblemQuantity > 0 {
				p, err := s.st.ProblemOfMatch(ctx, m.ID)
				if err == store.ErrNotFound {
					continue
				}
				if err != nil {
					return err
				}
				if p.Resolution != nil {
					blockers = append(blockers, Blocker{Type: "problem", ID: p.ID.Hex(), Label: p.Type + " x" + itoa(p.Quantity), ParentID: l.VendorOrderID.Hex()})
				} else {
					problems[m.ID] = p
				}
			}
		}
		if len(blockers) > 0 {
			return &BlockedError{Blockers: blockers}
		}
		v := domain.Void{Reason: reason, By: actor.UserID, At: st.now}
		touched := map[bson.ObjectID]bool{}
		for _, m := range matches {
			l, o, err := s.loadLine(ctx, st, m.VendorOrderLineID)
			if err != nil {
				return err
			}
			if !touched[l.ID] {
				touched[l.ID] = true
				if err := s.st.BumpLine(ctx, l.ID); err != nil {
					return err
				}
			}
			if err := s.st.VoidMatch(ctx, m.ID, v); err != nil {
				return mapStore(err)
			}
			if p := problems[m.ID]; p != nil {
				if err := s.st.VoidProblem(ctx, p.ID, v); err != nil {
					return mapStore(err)
				}
				st.problemEvent("problem.reported", l, p, true)
			}
			st.touch(l)
			st.lineEvent(o, l, "vendor_order.delivery_match_voided", "DL-"+itoa(d.Number), ch("receivedQuantity", m.GoodQuantity, 0))
		}
		lines, err := s.st.DeliveryLinesOf(ctx, d.ID)
		if err != nil {
			return err
		}
		hadPending := false
		for _, dl := range lines {
			if dl.MatchState == domain.MatchUnmatched || dl.MatchState == domain.MatchPartial {
				hadPending = true
			}
		}
		if err := s.st.MarkDeliveryLinesVoided(ctx, d.ID); err != nil {
			return err
		}
		if d, err = s.st.UpdateDelivery(ctx, d.ID, d.Version, bson.D{{Key: "voided", Value: v}}); err != nil {
			return mapStore(err)
		}
		st.d = d
		st.events = append(st.events, domain.AuditEvent{Actor: actor.UserID.Hex(), ObjectType: "delivery", ObjectID: d.ID.Hex(),
			Action: "delivery.voided", Comment: reason, Changes: []domain.AuditChange{ch("voided", nil, true)}})
		if hadPending {
			st.emits = append(st.emits, store.EventRecord{Type: "delivery.needs_matching", Actor: actor.UserID.Hex(), ObjectID: d.ID.Hex(), Undone: true})
		}
		if err := s.finish(ctx, st); err != nil {
			return err
		}
		out, err = s.detail(ctx, d)
		return err
	})
	return out, err
}
