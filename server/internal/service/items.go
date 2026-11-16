package service

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// MaxItemsPerBatch caps non-withdrawn items in one batch (spec §9.1). It is a
// variable only so tests can lower it.
var MaxItemsPerBatch = 5000

type Items struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
}

func NewItems(st *store.Store, a *audit.Log, b *Batches) *Items {
	return &Items{st: st, audit: a, batches: b}
}

// ItemInput carries the user-editable item fields.
type ItemInput struct {
	SubgroupID         string
	Name               string
	Vendor             string
	SKU                string
	Quantity           int
	EstimatedUnitPrice domain.Money
	Priority           int
	Purpose            string
	Notes              string
	ProductURL         string
	AutoFilledFields   []string
	LookupProvider     string
}

func (in ItemInput) fields() domain.ItemFields {
	return domain.ItemFields{
		SubgroupID: in.SubgroupID, Name: in.Name, Vendor: in.Vendor, SKU: in.SKU, Quantity: in.Quantity,
		EstimatedUnitPrice: in.EstimatedUnitPrice, Priority: in.Priority, Purpose: in.Purpose,
		Notes: in.Notes, ProductURL: in.ProductURL,
	}
}

func (s *Items) validate(in ItemInput, t *domain.Team) error {
	if errs := domain.ValidateItemFields(in.fields(), s.batches.supported, s.batches.cur); len(errs) > 0 {
		return &ValidationError{Fields: errs}
	}
	if in.SubgroupID != "" {
		for _, g := range t.Subgroups {
			if g.ID == in.SubgroupID && g.Active {
				return nil
			}
		}
		return Invalid("subgroupId", "unknown or inactive subgroup")
	}
	return nil
}

func (s *Items) event(actor string, b *domain.Batch, it *domain.Item, action string, comment string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{
		Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectType: "item", ObjectID: it.ID.Hex(),
		Action: action, Comment: comment, Changes: changes,
	}
}

// List returns a batch's items to anyone who can read the batch.
func (s *Items) List(ctx context.Context, actor authz.Actor, batchID bson.ObjectID) ([]domain.Item, error) {
	if _, _, err := s.batches.load(ctx, actor, batchID); err != nil {
		return nil, err
	}
	items, err := s.st.ListItems(ctx, batchID)
	if items == nil {
		items = []domain.Item{}
	}
	return items, err
}

// Add creates an item: team members, while the batch is `proposed` (proposer
// only) or `collecting` (spec §8.3).
func (s *Items) Add(ctx context.Context, actor authz.Actor, batchID bson.ObjectID, in ItemInput) (*domain.Item, error) {
	b, t, err := s.batches.load(ctx, actor, batchID)
	if err != nil {
		return nil, err
	}
	if !actor.IsMember(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	switch b.Status {
	case domain.BatchProposed:
		if b.CreatedBy != actor.UserID {
			return nil, ErrForbidden
		}
	case domain.BatchCollecting:
	default:
		return nil, Rule("batch_not_collecting", "Batch is not accepting items.")
	}
	in.Name, in.Purpose = strings.TrimSpace(in.Name), strings.TrimSpace(in.Purpose)
	if in.SubgroupID == "" {
		if m, err := s.st.GetMembership(ctx, t.ID, actor.UserID); err == nil {
			for _, g := range t.Subgroups {
				if g.ID == m.DefaultSubgroupID && g.Active {
					in.SubgroupID = g.ID
				}
			}
		}
	}
	if err := s.validate(in, t); err != nil {
		return nil, err
	}
	it := &domain.Item{
		TeamID: t.ID, BatchID: b.ID, RequesterID: actor.UserID, Status: domain.ItemPending,
		SubgroupID: in.SubgroupID, Name: in.Name, Vendor: in.Vendor, SKU: in.SKU, Quantity: in.Quantity,
		EstimatedUnitPrice: in.EstimatedUnitPrice, Priority: in.Priority, Purpose: in.Purpose, Notes: in.Notes, ProductURL: in.ProductURL,
	}
	if len(in.AutoFilledFields) > 0 {
		it.Lookup = &domain.LookupInfo{Provider: in.LookupProvider, FetchedAt: s.batches.now(), AutoFilledFields: in.AutoFilledFields}
	}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		counts, err := s.st.ItemCounts(ctx, b.ID) // non-withdrawn items
		if err != nil {
			return err
		}
		total := 0
		for _, n := range counts {
			total += n
		}
		if total >= MaxItemsPerBatch {
			return Rule("batch_item_limit", "A batch holds at most %d items.", MaxItemsPerBatch)
		}
		seq, err := s.st.NextItemSeq(ctx, b.ID)
		if err != nil {
			return mapStore(err)
		}
		it.SeqNo = seq
		if err := s.st.InsertItem(ctx, it); err != nil {
			return err
		}
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), b, it, "item.created", "",
			domain.AuditChange{Field: "status", From: "", To: string(it.Status)}))
	})
	if err != nil {
		return nil, err
	}
	return it, nil
}

// loadItem fetches an item together with its batch/team and checks read access.
func (s *Items) loadItem(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Item, *domain.Batch, *domain.Team, error) {
	it, err := s.st.GetItem(ctx, id)
	if err != nil {
		return nil, nil, nil, mapStore(err)
	}
	b, t, err := s.batches.load(ctx, actor, it.BatchID)
	if err != nil {
		return nil, nil, nil, err
	}
	return it, b, t, nil
}

// canModify implements "edit/withdraw own item" and the team-admin override
// (spec §8.3). System admins hold every Team-admin permission (§8.1).
func canModify(actor authz.Actor, it *domain.Item, b *domain.Batch) bool {
	if it.RequesterID == actor.UserID {
		switch {
		case it.Status == domain.ItemPending && (b.Status == domain.BatchProposed || b.Status == domain.BatchCollecting):
			return true
		case it.Status == domain.ItemReturned && b.Status == domain.BatchReviewing:
			return true
		}
	}
	return actor.CanAdminTeam(b.TeamID) && b.Status == domain.BatchCollecting &&
		(it.Status == domain.ItemPending || it.Status == domain.ItemReturned)
}

// Update edits item fields in place (full replacement of editable fields).
func (s *Items) Update(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in ItemInput) (*domain.Item, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if !canModify(actor, it, b) {
		if it.RequesterID == actor.UserID || actor.CanAdminTeam(b.TeamID) {
			return nil, Rule("item_not_editable", "This item can no longer be edited.")
		}
		return nil, ErrForbidden
	}
	in.Name, in.Purpose = strings.TrimSpace(in.Name), strings.TrimSpace(in.Purpose)
	if err := s.validate(in, t); err != nil {
		return nil, err
	}
	set := bson.D{
		{Key: "subgroupId", Value: in.SubgroupID}, {Key: "name", Value: in.Name}, {Key: "vendor", Value: in.Vendor},
		{Key: "sku", Value: in.SKU}, {Key: "quantity", Value: in.Quantity},
		{Key: "estimatedUnitPrice", Value: in.EstimatedUnitPrice}, {Key: "priority", Value: in.Priority},
		{Key: "purpose", Value: in.Purpose}, {Key: "notes", Value: in.Notes}, {Key: "productUrl", Value: in.ProductURL},
	}
	changes := diffItem(it, in)
	if len(changes) == 0 {
		if it.Version != version {
			return nil, ErrVersionConflict
		}
		return it, nil
	}
	var out *domain.Item
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		ni, err := s.st.UpdateItem(ctx, it.ID, version, set)
		if err != nil {
			return mapStore(err)
		}
		out = ni
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), b, ni, "item.updated", "", changes...))
	})
	return out, err
}

func diffItem(it *domain.Item, in ItemInput) []domain.AuditChange {
	var ch []domain.AuditChange
	add := func(f string, from, to any) { ch = append(ch, domain.AuditChange{Field: f, From: from, To: to}) }
	if it.Name != in.Name {
		add("name", it.Name, in.Name)
	}
	if it.SubgroupID != in.SubgroupID {
		add("subgroupId", it.SubgroupID, in.SubgroupID)
	}
	if it.Vendor != in.Vendor {
		add("vendor", it.Vendor, in.Vendor)
	}
	if it.SKU != in.SKU {
		add("sku", it.SKU, in.SKU)
	}
	if it.Quantity != in.Quantity {
		add("quantity", it.Quantity, in.Quantity)
	}
	if !it.EstimatedUnitPrice.Amount.Equal(in.EstimatedUnitPrice.Amount.Decimal) || it.EstimatedUnitPrice.Currency != in.EstimatedUnitPrice.Currency {
		add("estimatedUnitPrice", it.EstimatedUnitPrice.Amount.String()+" "+it.EstimatedUnitPrice.Currency,
			in.EstimatedUnitPrice.Amount.String()+" "+in.EstimatedUnitPrice.Currency)
	}
	if it.Priority != in.Priority {
		add("priority", it.Priority, in.Priority)
	}
	if it.Purpose != in.Purpose {
		add("purpose", it.Purpose, in.Purpose)
	}
	if it.Notes != in.Notes {
		add("notes", it.Notes, in.Notes)
	}
	if it.ProductURL != in.ProductURL {
		add("productUrl", it.ProductURL, in.ProductURL)
	}
	return ch
}

// Withdraw marks the item withdrawn (requester, or team admin while collecting).
func (s *Items) Withdraw(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*domain.Item, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if !canModify(actor, it, b) {
		if it.RequesterID == actor.UserID || actor.CanAdminTeam(b.TeamID) {
			return nil, Rule("item_not_editable", "This item can no longer be withdrawn.")
		}
		return nil, ErrForbidden
	}
	return s.transitionItem(ctx, actor.UserID.Hex(), b, it, version, domain.EvWithdraw, "item.withdrawn", "", nil)
}

// Resubmit sends a returned item back to review. The requester must have
// edited it since it was returned (spec §10.2).
func (s *Items) Resubmit(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64) (*domain.Item, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if it.RequesterID != actor.UserID {
		return nil, ErrForbidden
	}
	if b.Status != domain.BatchReviewing || it.Status != domain.ItemReturned {
		return nil, Rule("invalid_transition", "Only returned items in a batch under review can be resubmitted.")
	}
	if it.Review != nil && it.Version <= it.Review.AtVersion {
		return nil, Rule("item_not_edited", "Edit the item before resubmitting it.")
	}
	return s.transitionItem(ctx, actor.UserID.Hex(), b, it, version, domain.EvResubmit, "item.resubmitted", "", nil)
}

// transitionItem applies a single event with audit and batch re-evaluation.
func (s *Items) transitionItem(ctx context.Context, actor string, b *domain.Batch, it *domain.Item, version int64,
	ev domain.ItemEvent, action, comment string, review *domain.Review) (*domain.Item, error) {
	return s.transitionItemSet(ctx, actor, b, it, version, ev, action, comment, review, nil)
}

// transitionItemSet is transitionItem that also sets `extra` fields.
func (s *Items) transitionItemSet(ctx context.Context, actor string, b *domain.Batch, it *domain.Item, version int64,
	ev domain.ItemEvent, action, comment string, review *domain.Review, extra bson.D) (*domain.Item, error) {
	to, err := domain.NextItemStatus(it.Status, ev)
	if err != nil {
		return nil, ruleFromDomain(err)
	}
	set := append(bson.D{{Key: "status", Value: to}}, extra...)
	if review != nil {
		review.AtVersion = version + 1
		set = append(set, bson.E{Key: "review", Value: review})
	}
	var out *domain.Item
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		ni, err := s.st.UpdateItem(ctx, it.ID, version, set)
		if err != nil {
			return mapStore(err)
		}
		out = ni
		if err := s.audit.Record(ctx, s.event(actor, b, ni, action, comment,
			domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)})); err != nil {
			return err
		}
		return s.st.BumpBatch(ctx, b.ID) // review actions exclude confirm_review (spec §10)
	})
	return out, err
}

// ---- review ----

type Decision struct {
	ItemID   bson.ObjectID
	Decision string // approve | return | reject
	Comment  string
}

type ReviewResult struct {
	Items []domain.Item
	Batch *domain.Batch
}

var decisionEvent = map[string]struct {
	ev       domain.ItemEvent
	recorded string
	action   string
}{
	"approve": {domain.EvApprove, "approved", "item.approved"},
	"return":  {domain.EvReturn, "returned", "item.returned"},
	"reject":  {domain.EvReject, "rejected", "item.rejected"},
}

// Review applies a list of decisions atomically: approvers (or team admins)
// while the batch is `reviewing`. `return` and `reject` need a comment.
func (s *Items) Review(ctx context.Context, actor authz.Actor, batchID bson.ObjectID, decisions []Decision) (*ReviewResult, error) {
	b, t, err := s.batches.load(ctx, actor, batchID)
	if err != nil {
		return nil, err
	}
	if !actor.HasBatchRole(t.ID, authzAssignments(b.Assignments), authz.BatchApprover) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if b.Status != domain.BatchReviewing {
		return nil, Rule("batch_not_reviewing", "Batch is not under review.")
	}
	if len(decisions) == 0 || len(decisions) > 1000 {
		return nil, Invalid("decisions", "between 1 and 1000 decisions are required")
	}
	seen := map[bson.ObjectID]bool{}
	for i, d := range decisions {
		if _, ok := decisionEvent[d.Decision]; !ok {
			return nil, Invalid("decisions", "unknown decision at position "+itoa(i))
		}
		if d.Decision != "approve" && strings.TrimSpace(d.Comment) == "" {
			return nil, Invalid("decisions", "a comment is required to "+d.Decision+" (position "+itoa(i)+")")
		}
		if seen[d.ItemID] {
			return nil, Invalid("decisions", "duplicate item at position "+itoa(i))
		}
		seen[d.ItemID] = true
	}

	res := &ReviewResult{}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		res.Items = res.Items[:0]
		var evs []domain.AuditEvent
		now := s.batches.now()
		for _, d := range decisions {
			it, err := s.st.GetItem(ctx, d.ItemID)
			if err != nil || it.BatchID != b.ID {
				return Invalid("decisions", d.ItemID.Hex()+" is not an item of this batch")
			}
			meta := decisionEvent[d.Decision]
			to, err := domain.NextItemStatus(it.Status, meta.ev)
			if err != nil {
				return Rule("item_not_reviewable", "Item #%d is %s and cannot be %s.", it.SeqNo, it.Status, meta.recorded)
			}
			comment := strings.TrimSpace(d.Comment)
			ni, err := s.st.UpdateItem(ctx, it.ID, it.Version, bson.D{
				{Key: "status", Value: to},
				{Key: "review", Value: domain.Review{Decision: meta.recorded, By: actor.UserID, At: now, Comment: comment, AtVersion: it.Version + 1}},
			})
			if err != nil {
				return mapStore(err)
			}
			res.Items = append(res.Items, *ni)
			evs = append(evs, s.event(actor.UserID.Hex(), b, ni, meta.action, comment,
				domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)}))
		}
		if err := s.audit.Record(ctx, evs...); err != nil {
			return err
		}
		if err := s.st.BumpBatch(ctx, b.ID); err != nil {
			return err
		}
		nb, err := s.st.GetBatch(ctx, b.ID)
		res.Batch = nb
		return err
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// ForceReject lets a team admin reject a pending or returned item during review.
func (s *Items) ForceReject(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*domain.Item, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if !actor.CanAdminTeam(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if b.Status != domain.BatchReviewing {
		return nil, Rule("batch_not_reviewing", "Batch is not under review.")
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, Invalid("reason", "required")
	}
	return s.transitionItem(ctx, actor.UserID.Hex(), b, it, version, domain.EvForceReject, "item.force_rejected", reason,
		&domain.Review{Decision: "rejected", By: actor.UserID, At: s.batches.now(), Comment: reason, Forced: true})
}

// UndoReview returns an approved, rejected or returned item to pending
// before the review is confirmed (spec §10.2, §10.5). The reviewer who made
// the decision and team admins may undo.
func (s *Items) UndoReview(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*domain.Item, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if it.Review == nil || !(actor.IsTeamAdmin(t.ID) || it.Review.By == actor.UserID) {
		return nil, ErrForbidden
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, Invalid("reason", "required")
	}
	if b.Status != domain.BatchReviewing {
		return nil, &BlockedError{Blockers: []Blocker{{Type: "batch", ID: b.ID.Hex(), Label: "review confirmed"}}}
	}
	prev := it.Review.Decision
	var out *domain.Item
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		to, err := domain.NextItemStatus(it.Status, domain.EvUndoDecision)
		if err != nil {
			return ruleFromDomain(err)
		}
		ni, err := s.st.UpdateItem(ctx, it.ID, version, bson.D{{Key: "status", Value: to}, {Key: "review", Value: nil}})
		if err != nil {
			return mapStore(err)
		}
		out = ni
		if err := s.st.BumpBatch(ctx, b.ID); err != nil {
			return err
		}
		if err := s.st.Emit(ctx, store.EventRecord{Type: "item." + prev, Actor: actor.UserID.Hex(), TeamID: b.TeamID, BatchID: b.ID, ObjectID: it.ID.Hex(), Undone: true}); err != nil {
			return err
		}
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), b, ni, "item.review_undone", reason,
			domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)}))
	})
	return out, err
}

// Copy creates a new pending item in the same batch from a withdrawn one
// (spec §10.2): the requester or a team admin, while the batch accepts items.
func (s *Items) Copy(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Item, error) {
	it, _, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if it.Status != domain.ItemWithdrawn {
		return nil, Rule("invalid_transition", "Only withdrawn items can be copied.")
	}
	if it.RequesterID != actor.UserID && !actor.IsTeamAdmin(t.ID) {
		return nil, ErrForbidden
	}
	return s.Add(ctx, actor, it.BatchID, ItemInput{
		SubgroupID: it.SubgroupID, Name: it.Name, Vendor: it.Vendor, SKU: it.SKU, Quantity: it.Quantity,
		EstimatedUnitPrice: it.EstimatedUnitPrice, Priority: it.Priority, Purpose: it.Purpose, Notes: it.Notes, ProductURL: it.ProductURL,
	})
}

// purchasingGate loads an item for a purchaser action: the item must be
// approved in a review-confirmed batch that is not purchased outside.
func (s *Items) purchasingGate(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Item, *domain.Batch, error) {
	it, b, t, err := s.loadItem(ctx, actor, id)
	if err != nil {
		return nil, nil, err
	}
	if !actor.IsPurchaser {
		return nil, nil, ErrForbidden
	}
	if t.Archived {
		return nil, nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if it.Status != domain.ItemApproved || b.ReviewConfirmation == nil || b.ReviewConfirmation.PurchaseOutside {
		return nil, nil, Rule("invalid_transition", "Only approved items of a review-confirmed batch can be marked.")
	}
	return it, b, nil
}

// MarkUnpurchasable marks an approved item as not buyable, or "don't buy the
// remaining quantity" when it already has placed lines (spec §10.2).
func (s *Items) MarkUnpurchasable(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*domain.Item, error) {
	it, b, err := s.purchasingGate(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, Invalid("reason", "required")
	}
	return s.setUnpurchasable(ctx, actor, b, it, version, reason, true)
}

// UndoUnpurchasable removes the mark (spec §10.5).
func (s *Items) UndoUnpurchasable(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*domain.Item, error) {
	it, b, err := s.purchasingGate(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, Invalid("reason", "required")
	}
	if it.Unpurchasable == nil {
		return nil, Rule("invalid_transition", "The item is not marked unpurchasable.")
	}
	return s.setUnpurchasable(ctx, actor, b, it, version, reason, false)
}

func (s *Items) setUnpurchasable(ctx context.Context, actor authz.Actor, b *domain.Batch, it *domain.Item, version int64, reason string, mark bool) (*domain.Item, error) {
	var out *domain.Item
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		if mark {
			if it.Unpurchasable != nil {
				return Rule("invalid_transition", "The item is already marked unpurchasable.")
			}
			lines, err := s.batches.linesOf(ctx, it.ID)
			if err != nil {
				return err
			}
			var blockers []Blocker
			for _, l := range lines {
				if l.Status == domain.LineDraft {
					blockers = append(blockers, Blocker{Type: "vendor_order_line", ID: l.ID.Hex(), Label: "draft line"})
				}
			}
			if len(blockers) > 0 {
				return &BlockedError{Blockers: blockers}
			}
		}
		var val any
		if mark {
			val = domain.UnpurchasableMark{By: actor.UserID, At: s.batches.now(), Reason: reason}
		}
		ni, err := s.st.UpdateItem(ctx, it.ID, version, bson.D{{Key: "unpurchasable", Value: val}})
		if err != nil {
			return mapStore(err)
		}
		// The write above bumped the item; refresh recomputes on that version.
		if err := s.batches.refreshItem(ctx, b, ni); err != nil {
			return err
		}
		if out, err = s.st.GetItem(ctx, it.ID); err != nil {
			return mapStore(err)
		}
		if err := s.st.BumpBatch(ctx, b.ID); err != nil {
			return err
		}
		if err := s.batches.DeriveStatus(ctx, b.ID); err != nil {
			return err
		}
		action, typ := "item.unpurchasable", "item.unpurchasable"
		if !mark {
			action = "item.unpurchasable_undone"
		}
		if err := s.st.Emit(ctx, store.EventRecord{Type: typ, Actor: actor.UserID.Hex(), TeamID: b.TeamID, BatchID: b.ID, ObjectID: it.ID.Hex(), Undone: !mark}); err != nil {
			return err
		}
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), b, out, action, reason,
			domain.AuditChange{Field: "unpurchasable", From: it.Unpurchasable != nil, To: mark}))
	})
	return out, err
}

func authzAssignments(a domain.Assignments) authz.Assignments {
	return authz.Assignments{Approvers: a.Approvers, Purchasers: a.Purchasers}
}

func itoa(i int) string { return strconvItoa(i) }
