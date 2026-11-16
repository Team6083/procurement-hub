package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

const (
	JobBatchClose            = "batch.close"
	JobBatchDeadlineReminder = "batch.deadline_reminder"
)

func closeJobKey(id bson.ObjectID) string    { return JobBatchClose + ":" + id.Hex() }
func reminderJobKey(id bson.ObjectID) string { return JobBatchDeadlineReminder + ":" + id.Hex() }

type Batches struct {
	st        *store.Store
	audit     *audit.Log
	supported []string
	cur       domain.Currencies
	now       func() time.Time
}

func NewBatches(st *store.Store, a *audit.Log, supportedCurrencies []string, cur domain.Currencies) *Batches {
	return &Batches{st: st, audit: a, supported: supportedCurrencies, cur: cur, now: func() time.Time { return time.Now().UTC() }}
}

// batchCtx loads a batch with its team and enforces read visibility.
func (s *Batches) load(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Batch, *domain.Team, error) {
	b, err := s.st.GetBatch(ctx, id)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	t, err := s.st.GetTeam(ctx, b.TeamID)
	if err != nil {
		return nil, nil, mapStore(err)
	}
	if !actor.CanReadBatch(t.ID, t.Visibility, b.VisibilityOverride) {
		// Do not reveal existence of invisible batches.
		return nil, nil, ErrNotFound
	}
	return b, t, nil
}

func (s *Batches) Get(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Batch, *domain.Team, error) {
	return s.load(ctx, actor, id)
}

type CreateBatchInput struct {
	Title       string
	Description string
	Propose     bool
}

// Create makes a draft batch (team admin, propose=false) or a proposal (any member).
func (s *Batches) Create(ctx context.Context, actor authz.Actor, teamID bson.ObjectID, in CreateBatchInput) (*domain.Batch, error) {
	t, err := s.st.GetTeam(ctx, teamID)
	if err != nil {
		return nil, mapStore(err)
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || len([]rune(title)) > 200 {
		return nil, Invalid("title", "required, at most 200 characters")
	}
	b := &domain.Batch{TeamID: teamID, Title: title, Description: in.Description, CreatedBy: actor.UserID}
	switch {
	case actor.CanAdminTeam(teamID) && !in.Propose:
		b.Status, b.Origin = domain.BatchDraft, "created"
	case actor.IsMember(teamID):
		b.Status, b.Origin = domain.BatchProposed, "proposed"
	default:
		return nil, ErrForbidden
	}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		n, err := s.st.NextBatchNumber(ctx, teamID)
		if err != nil {
			return mapStore(err)
		}
		b.Number = n
		if err := s.st.InsertBatch(ctx, b); err != nil {
			return err
		}
		action := "batch.created"
		if b.Status == domain.BatchProposed {
			action = "batch.proposed"
		}
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), b, action, domain.AuditChange{Field: "status", From: "", To: string(b.Status)}))
	})
	if err != nil {
		return nil, err
	}
	return b, nil
}

func (s *Batches) event(actor string, b *domain.Batch, action string, changes ...domain.AuditChange) domain.AuditEvent {
	return domain.AuditEvent{
		Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectType: "batch", ObjectID: b.ID.Hex(),
		Action: action, Changes: changes,
	}
}

// ---- list ----

type ListBatchesInput struct {
	TeamID bson.ObjectID
	Status domain.BatchStatus
	Query  string
	Cursor bson.ObjectID
	Limit  int
}

type BatchPage struct {
	Items      []domain.Batch
	NextCursor *bson.ObjectID
}

// List returns visible batches newest-first with cursor pagination. Visibility
// depends on the team (and per-batch override), so it is filtered after
// fetching; the scan continues until the page is full or data runs out.
func (s *Batches) List(ctx context.Context, actor authz.Actor, in ListBatchesInput) (*BatchPage, error) {
	limit := in.Limit
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	teams := map[bson.ObjectID]*domain.Team{}
	teamVis := func(id bson.ObjectID) (*domain.Team, error) {
		if t, ok := teams[id]; ok {
			return t, nil
		}
		t, err := s.st.GetTeam(ctx, id)
		if err != nil {
			return nil, err
		}
		teams[id] = t
		return t, nil
	}
	f := store.BatchFilter{TeamID: in.TeamID, Status: in.Status, Query: strings.TrimSpace(in.Query), After: in.Cursor}
	page := &BatchPage{Items: []domain.Batch{}}
	for {
		rows, err := s.st.ListBatches(ctx, f, int64(limit)*2)
		if err != nil {
			return nil, err
		}
		for _, b := range rows {
			t, err := teamVis(b.TeamID)
			if err != nil {
				return nil, mapStore(err)
			}
			if !actor.CanReadBatch(t.ID, t.Visibility, b.VisibilityOverride) {
				continue
			}
			if len(page.Items) == limit {
				last := page.Items[len(page.Items)-1].ID
				page.NextCursor = &last
				return page, nil
			}
			page.Items = append(page.Items, b)
		}
		if len(rows) < limit*2 {
			return page, nil
		}
		f.After = rows[len(rows)-1].ID
	}
}

// ---- update ----

type BatchPatch struct {
	Title              *string
	Description        *string
	DeadlineSet        bool
	Deadline           *time.Time
	VisibilitySet      bool
	VisibilityOverride domain.Visibility // "" clears
}

func isClosedStatus(s domain.BatchStatus) bool {
	return s == domain.BatchCompleted || s == domain.BatchCancelled || s == domain.BatchProposalRejected
}

func (s *Batches) Update(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, p BatchPatch) (*domain.Batch, error) {
	b, t, err := s.load(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if !actor.CanAdminTeam(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if isClosedStatus(b.Status) {
		return nil, Rule("batch_closed", "This batch can no longer be edited.")
	}
	var set bson.D
	var changes []domain.AuditChange
	chg := func(f string, from, to any) {
		set = append(set, bson.E{Key: f, Value: to})
		changes = append(changes, domain.AuditChange{Field: f, From: from, To: to})
	}
	if p.Title != nil && strings.TrimSpace(*p.Title) != b.Title {
		n := strings.TrimSpace(*p.Title)
		if n == "" || len([]rune(n)) > 200 {
			return nil, Invalid("title", "required, at most 200 characters")
		}
		chg("title", b.Title, n)
	}
	if p.Description != nil && *p.Description != b.Description {
		chg("description", b.Description, *p.Description)
	}
	deadlineChanged := false
	if p.DeadlineSet && !sameTime(p.Deadline, b.Deadline) {
		if b.Status == domain.BatchCollecting && (p.Deadline == nil || !p.Deadline.After(s.now())) {
			return nil, Rule(domain.ErrDeadlinePast.Error(), "The deadline must be in the future while collecting.")
		}
		chg("deadline", b.Deadline, p.Deadline)
		deadlineChanged = true
	}
	if p.VisibilitySet && p.VisibilityOverride != b.VisibilityOverride {
		if p.VisibilityOverride != "" && !p.VisibilityOverride.Valid() {
			return nil, Invalid("visibilityOverride", "must be null, public or members")
		}
		chg("visibilityOverride", b.VisibilityOverride, p.VisibilityOverride)
	}
	if len(set) == 0 {
		if b.Version != version {
			return nil, ErrVersionConflict
		}
		return b, nil
	}
	var out *domain.Batch
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		nb, err := s.st.UpdateBatch(ctx, b.ID, version, set)
		if err != nil {
			return mapStore(err)
		}
		out = nb
		if deadlineChanged && nb.Status == domain.BatchCollecting {
			if err := s.scheduleDeadlineJobs(ctx, nb); err != nil {
				return err
			}
		}
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), nb, "batch.updated", changes...))
	})
	return out, err
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// ---- assignments ----

type AssignmentsInput struct {
	Approvers, Purchasers []bson.ObjectID
}

func dedupe(ids []bson.ObjectID) []bson.ObjectID {
	seen := map[bson.ObjectID]bool{}
	out := []bson.ObjectID{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// SetAssignments replaces the batch's approvers and purchasers. Approvers must
// be team members; purchasers must have the role in users.roleSnapshot and
// grant nothing (spec §8.1).
func (s *Batches) SetAssignments(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in AssignmentsInput) (*domain.Batch, error) {
	b, t, err := s.load(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if !actor.CanAdminTeam(t.ID) {
		return nil, ErrForbidden
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	if isClosedStatus(b.Status) {
		return nil, Rule("batch_closed", "This batch can no longer be edited.")
	}
	next := domain.Assignments{Approvers: dedupe(in.Approvers), Purchasers: dedupe(in.Purchasers)}
	members, err := s.st.MembershipsByTeam(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	isMember := map[bson.ObjectID]bool{}
	for _, m := range members {
		isMember[m.UserID] = true
	}
	for _, uid := range next.Approvers {
		if !isMember[uid] {
			return nil, Invalid("approvers", uid.Hex()+" is not a member of this team")
		}
	}
	for _, uid := range next.Purchasers {
		u, err := s.st.GetUser(ctx, uid)
		if err != nil || !u.RoleSnapshot.Purchaser {
			return nil, Invalid("purchasers", uid.Hex()+" is not a purchaser")
		}
	}
	var out *domain.Batch
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		nb, err := s.st.UpdateBatch(ctx, b.ID, version, bson.D{{Key: "assignments", Value: next}})
		if err != nil {
			return mapStore(err)
		}
		out = nb
		return s.audit.Record(ctx, s.event(actor.UserID.Hex(), nb, "batch.assignments_changed",
			domain.AuditChange{Field: "assignments", From: b.Assignments, To: next}))
	})
	return out, err
}

// ---- transitions ----

type TransitionInput struct {
	Action          domain.BatchAction
	Reason          string
	Deadline        *time.Time
	PurchaseOutside bool
}

// Transition performs a manual lifecycle action (spec §16.2).
func (s *Batches) Transition(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in TransitionInput) (*domain.Batch, error) {
	b, t, err := s.load(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	isProposer := b.CreatedBy == actor.UserID && b.Origin == "proposed"
	switch in.Action {
	case domain.ActWithdrawProposal:
		if !isProposer {
			return nil, ErrForbidden
		}
	case domain.ActRestoreProposal:
		// A withdrawn proposal may also be restored by its proposer.
		if !actor.CanAdminTeam(t.ID) && !(isProposer && b.Status == domain.BatchCancelled) {
			return nil, ErrForbidden
		}
	case domain.ActConfirmReview, domain.ActUnconfirmReview:
		if !actor.HasBatchRole(t.ID, authzAssignments(b.Assignments), authz.BatchApprover) {
			return nil, ErrForbidden
		}
	default:
		if !actor.CanAdminTeam(t.ID) {
			return nil, ErrForbidden
		}
	}
	return s.transition(ctx, actor.UserID.Hex(), b, version, in, isProposer)
}

// transition is the permission-free core, also used by the deadline job.
func (s *Batches) transition(ctx context.Context, actorLabel string, b *domain.Batch, version int64, in TransitionInput, isProposer bool) (*domain.Batch, error) {
	var out *domain.Batch
	err := s.st.WithTx(ctx, func(ctx context.Context) error {
		cur, err := s.st.GetBatch(ctx, b.ID)
		if err != nil {
			return mapStore(err)
		}
		b = cur
		counts, err := s.st.ItemCounts(ctx, b.ID)
		if err != nil {
			return err
		}
		deadline := in.Deadline
		if in.Action == domain.ActOpen && deadline == nil {
			deadline = b.Deadline
		}
		res, err := domain.ApplyAction(b.Status, domain.ActionInput{
			Action: in.Action, Now: s.now(), Deadline: deadline, Assignments: b.Assignments,
			Reason: strings.TrimSpace(in.Reason), Items: counts, ActorIsProposer: isProposer,
			StatusBeforeCancel: b.StatusBeforeCancel,
		})
		if err != nil {
			return ruleFromDomain(err)
		}
		to := res.To
		var confirmation *domain.ReviewConfirmation
		var blockers []Blocker
		switch in.Action {
		case domain.ActConfirmReview:
			by, _ := bson.ObjectIDFromHex(actorLabel)
			confirmation = &domain.ReviewConfirmation{By: by, At: s.now(), PurchaseOutside: in.PurchaseOutside}
		case domain.ActUnconfirmReview:
			if blockers, err = s.unconfirmBlockers(ctx, b); err != nil {
				return err
			}
			if len(blockers) > 0 {
				return &BlockedError{Blockers: blockers}
			}
		}
		set := bson.D{
			{Key: "status", Value: to}, {Key: "statusReason", Value: res.Reason},
			{Key: "statusChangedAt", Value: s.now()},
			{Key: "statusBeforeCancel", Value: res.StatusBeforeCancel},
		}
		changes := []domain.AuditChange{{Field: "status", From: string(b.Status), To: string(to)}}
		if res.SetDeadline && deadline != nil {
			set = append(set, bson.E{Key: "deadline", Value: *deadline})
			changes = append(changes, domain.AuditChange{Field: "deadline", From: b.Deadline, To: *deadline})
		}
		if in.Action == domain.ActOpen && deadline != nil && b.Deadline == nil {
			set = append(set, bson.E{Key: "deadline", Value: *deadline})
		}
		switch in.Action {
		case domain.ActConfirmReview:
			set = append(set, bson.E{Key: "reviewConfirmation", Value: confirmation})
		case domain.ActUnconfirmReview:
			set = append(set, bson.E{Key: "reviewConfirmation", Value: nil})
		}
		nb, err := s.st.UpdateBatch(ctx, b.ID, version, set)
		if err != nil {
			return mapStore(err)
		}
		// Jobs follow the collecting state.
		switch {
		case res.To == domain.BatchCollecting:
			if err := s.scheduleDeadlineJobs(ctx, nb); err != nil {
				return err
			}
		case b.Status == domain.BatchCollecting:
			if err := s.cancelDeadlineJobs(ctx, nb.ID); err != nil {
				return err
			}
		}
		evs := []domain.AuditEvent{s.event(actorLabel, nb, "batch."+string(in.Action), changes...)}
		if res.Reason != "" {
			evs[0].Comment = res.Reason
		} else if in.Reason != "" {
			evs[0].Comment = strings.TrimSpace(in.Reason)
		}
		switch in.Action {
		case domain.ActConfirmReview:
			if err := s.afterConfirm(ctx, nb, &evs); err != nil {
				return err
			}
			if nb, err = s.st.GetBatch(ctx, nb.ID); err != nil {
				return err
			}
		case domain.ActUnconfirmReview:
			if err := s.afterUnconfirm(ctx, nb, actorLabel, &evs); err != nil {
				return err
			}
		}
		if err := s.emitBatchEvent(ctx, actorLabel, nb, in.Action); err != nil {
			return err
		}
		out = nb
		return s.audit.Record(ctx, evs...)
	})
	return out, err
}

// emitBatchEvent writes the notification event for a manual transition
// (spec §12.2); undo actions emit "<event>.undone". Sending is M6.
func (s *Batches) emitBatchEvent(ctx context.Context, actor string, b *domain.Batch, a domain.BatchAction) error {
	typ := "batch." + string(a)
	undone := false
	switch a {
	case domain.ActUnconfirmReview:
		typ, undone = "batch.review_confirmed", true
	case domain.ActUncancel:
		typ, undone = "batch.cancelled", true
	case domain.ActRestoreProposal:
		typ, undone = "batch.proposal_decided", true
	case domain.ActConfirmReview:
		typ = "batch.review_confirmed"
	case domain.ActRejectProposal, domain.ActWithdrawProposal:
		typ = "batch.proposal_decided"
	}
	return s.st.Emit(ctx, store.EventRecord{Type: typ, Actor: actor, TeamID: b.TeamID, BatchID: b.ID, ObjectID: b.ID.Hex(), Undone: undone})
}

// DeriveStatus re-derives the status of a review-confirmed batch from the
// fulfillment of its approved items (spec §10.1) inside the caller's
// transaction. Automatic changes are audited as system:derive and bump the
// batch version.
func (s *Batches) DeriveStatus(ctx context.Context, batchID bson.ObjectID) error {
	b, err := s.st.GetBatch(ctx, batchID)
	if err != nil {
		return mapStore(err)
	}
	if b.ReviewConfirmation == nil {
		return nil
	}
	items, err := s.st.ItemsByBatchStatus(ctx, b.ID, domain.ItemApproved)
	if err != nil {
		return err
	}
	var fs []domain.Fulfillment
	for _, it := range items {
		if it.Fulfillment != nil {
			fs = append(fs, *it.Fulfillment)
		}
	}
	to := domain.DeriveBatchStatus(fs)
	if to == b.Status {
		return nil
	}
	nb, err := s.st.UpdateBatch(ctx, b.ID, b.Version, bson.D{
		{Key: "status", Value: to}, {Key: "statusChangedAt", Value: s.now()}, {Key: "statusReason", Value: ""},
	})
	if err != nil {
		return mapStore(err)
	}
	return s.audit.Record(ctx, s.event(audit.SystemActor("derive"), nb, "batch.status_derived",
		domain.AuditChange{Field: "status", From: string(b.Status), To: string(to)}))
}

// unconfirmBlockers: items linked to placed lines or marked unpurchasable
// (spec §10.1, §10.5).
func (s *Batches) unconfirmBlockers(ctx context.Context, b *domain.Batch) ([]Blocker, error) {
	items, err := s.st.ItemsByBatchStatus(ctx, b.ID, domain.ItemApproved)
	if err != nil {
		return nil, err
	}
	var out []Blocker
	for _, it := range items {
		if it.Unpurchasable != nil {
			out = append(out, Blocker{Type: "item", ID: it.ID.Hex(), Label: "#" + itoa(it.SeqNo) + " " + it.Name + " (unpurchasable)"})
		}
		placed, err := s.placedLinesOf(ctx, it.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, placed...)
	}
	return out, nil
}

// afterConfirm initialises the computed purchasing fields of the approved
// items and derives the batch status.
func (s *Batches) afterConfirm(ctx context.Context, b *domain.Batch, evs *[]domain.AuditEvent) error {
	items, err := s.st.ItemsByBatchStatus(ctx, b.ID, domain.ItemApproved)
	if err != nil {
		return err
	}
	for _, it := range items {
		if err := s.refreshItem(ctx, b, &it); err != nil {
			return err
		}
	}
	return s.DeriveStatus(ctx, b.ID)
}

// afterUnconfirm clears computed fields and removes draft lines of the
// batch's items (their content is written to audit).
func (s *Batches) afterUnconfirm(ctx context.Context, b *domain.Batch, actor string, evs *[]domain.AuditEvent) error {
	items, err := s.st.ItemsByBatchStatus(ctx, b.ID, domain.ItemApproved)
	if err != nil {
		return err
	}
	for _, it := range items {
		removed, err := s.removeDraftLinesOf(ctx, b, &it, actor)
		if err != nil {
			return err
		}
		*evs = append(*evs, removed...)
		if _, err := s.st.UpdateItem(ctx, it.ID, it.Version, bson.D{
			{Key: "fulfillment", Value: nil}, {Key: "plannedQuantity", Value: 0}, {Key: "toPurchaseQuantity", Value: 0},
			{Key: "orderedQuantity", Value: 0}, {Key: "receivedQuantity", Value: 0}, {Key: "costBase", Value: nil},
		}); err != nil {
			return mapStore(err)
		}
	}
	return nil
}

// ---- deadline jobs ----

func (s *Batches) scheduleDeadlineJobs(ctx context.Context, b *domain.Batch) error {
	if b.Deadline == nil {
		return nil
	}
	payload := bson.M{"batchId": b.ID}
	if err := s.st.UpsertJob(ctx, closeJobKey(b.ID), JobBatchClose, *b.Deadline, payload); err != nil {
		return err
	}
	if remind := b.Deadline.Add(-24 * time.Hour); remind.After(s.now()) {
		return s.st.UpsertJob(ctx, reminderJobKey(b.ID), JobBatchDeadlineReminder, remind, payload)
	}
	return s.st.DeleteJob(ctx, reminderJobKey(b.ID))
}

func (s *Batches) cancelDeadlineJobs(ctx context.Context, id bson.ObjectID) error {
	if err := s.st.DeleteJob(ctx, closeJobKey(id)); err != nil {
		return err
	}
	return s.st.DeleteJob(ctx, reminderJobKey(id))
}

// CloseDue is the batch.close job: it closes collection once the deadline has
// passed. It is idempotent and a no-op if the batch has moved on or the
// deadline was extended since the job was scheduled.
func (s *Batches) CloseDue(ctx context.Context, batchID bson.ObjectID) error {
	b, err := s.st.GetBatch(ctx, batchID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return err
	}
	if b.Status != domain.BatchCollecting || b.Deadline == nil || b.Deadline.After(s.now()) {
		return nil
	}
	_, err = s.transition(ctx, audit.SystemActor("batch.close"), b, b.Version, TransitionInput{Action: domain.ActClose}, false)
	if errors.Is(err, ErrVersionConflict) {
		return nil // someone else changed it concurrently; the job will not be retried needlessly
	}
	return err
}

// ruleFromDomain converts domain guard failures into API business errors.
func ruleFromDomain(err error) error {
	switch {
	case errors.Is(err, domain.ErrInvalidTransition):
		return Rule("invalid_transition", "%s", err.Error())
	case errors.Is(err, domain.ErrAssignmentsIncomplete):
		return Rule(err.Error(), "A batch needs at least one approver.")
	case errors.Is(err, domain.ErrDeadlineRequired):
		return Rule(err.Error(), "A deadline is required.")
	case errors.Is(err, domain.ErrDeadlinePast):
		return Rule(err.Error(), "The deadline must be in the future.")
	case errors.Is(err, domain.ErrNoPendingItems):
		return Rule(err.Error(), "The batch has no pending items to review.")
	case errors.Is(err, domain.ErrReasonRequired):
		return Rule(err.Error(), "A reason is required.")
	case errors.Is(err, domain.ErrItemsUndecided):
		return Rule(err.Error(), "Every item must be approved or rejected before confirming the review.")
	case errors.Is(err, domain.ErrNotProposer):
		return ErrForbidden
	}
	return err
}
