package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/authz"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
)

type flowEnv struct {
	st                      *store.Store
	teams                   *Teams
	batches                 *Batches
	items                   *Items
	team                    *domain.Team
	admin, approver, member authz.Actor
}

func newFlowEnv(t *testing.T) *flowEnv {
	t.Helper()
	st := testStore(t)
	ctx := context.Background()
	log := audit.New(st.DB)
	e := &flowEnv{st: st, teams: NewTeams(st, log, "USD", []string{"USD"})}
	e.batches = NewBatches(st, log, []string{"USD"})
	e.items = NewItems(st, log, e.batches)

	mk := func(sub string) *domain.User {
		u, err := st.UpsertUser(ctx, sub, sub, sub+"@example.org", sub)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	root, adm, appr, mem := mk("root"), mk("adm"), mk("appr"), mk("mem")
	team, err := e.teams.Create(ctx, authz.Actor{UserID: root.ID, IsSystemAdmin: true},
		CreateTeamInput{Slug: "flow", Name: "Flow", FirstAdminID: adm.ID})
	if err != nil {
		t.Fatal(err)
	}
	e.team = team
	e.admin = authz.Actor{UserID: adm.ID, TeamRoles: map[bson.ObjectID]domain.Role{team.ID: domain.RoleAdmin}}
	for _, u := range []*domain.User{appr, mem} {
		if _, _, err := e.teams.AddMember(ctx, e.admin, team.ID, u.ID, domain.RoleMember); err != nil {
			t.Fatal(err)
		}
	}
	member := map[bson.ObjectID]domain.Role{team.ID: domain.RoleMember}
	e.approver = authz.Actor{UserID: appr.ID, TeamRoles: member}
	e.member = authz.Actor{UserID: mem.ID, TeamRoles: member}
	return e
}

func (e *flowEnv) item(t *testing.T, who authz.Actor, batch bson.ObjectID, name string) *domain.Item {
	t.Helper()
	p, _ := domain.NewDecimal("5")
	it, err := e.items.Add(context.Background(), who, batch, ItemInput{
		Name: name, Quantity: 1, Priority: 3, Purpose: "test", EstimatedUnitPrice: domain.Money{Amount: p, Currency: "USD"},
	})
	if err != nil {
		t.Fatalf("add %s: %v", name, err)
	}
	return it
}

// openBatch creates a draft, assigns everyone and opens it for collection.
func (e *flowEnv) openBatch(t *testing.T) *domain.Batch {
	t.Helper()
	ctx := context.Background()
	b, err := e.batches.Create(ctx, e.admin, e.team.ID, CreateBatchInput{Title: "Round 1"})
	if err != nil || b.Status != domain.BatchDraft || b.Number != 1 {
		t.Fatalf("create: %v %+v", err, b)
	}
	b, err = e.batches.SetAssignments(ctx, e.admin, b.ID, b.Version, AssignmentsInput{
		Approvers: []bson.ObjectID{e.approver.UserID}, Purchasers: []bson.ObjectID{e.admin.UserID}, Receivers: []bson.ObjectID{e.member.UserID},
	})
	if err != nil {
		t.Fatal(err)
	}
	dl := time.Now().Add(48 * time.Hour)
	b, err = e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActOpen, Deadline: &dl})
	if err != nil || b.Status != domain.BatchCollecting {
		t.Fatalf("open: %v %+v", err, b)
	}
	return b
}

// Acceptance criterion 3: review with approve/return/reject; the batch stays
// in review until the returned item is resubmitted and approved.
func TestReviewFlowToOrdering(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)

	var its []*domain.Item
	for _, n := range []string{"a", "b", "c", "d"} {
		its = append(its, e.item(t, e.member, b.ID, n))
	}
	// Opening scheduled the close job.
	if _, err := e.st.ClaimDueJob(ctx, "x", time.Now().Add(72*time.Hour), time.Minute); err != nil {
		t.Fatalf("close job not scheduled: %v", err)
	}

	b, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActClose})
	if err != nil || b.Status != domain.BatchReviewing {
		t.Fatalf("close: %v %+v", err, b)
	}
	if _, err := e.items.Add(ctx, e.member, b.ID, ItemInput{}); err == nil {
		t.Error("adding items must be rejected once review started")
	}

	// A plain member may not review.
	if _, err := e.items.Review(ctx, e.member, b.ID, []Decision{{ItemID: its[0].ID, Decision: "approve"}}); !errors.Is(err, ErrForbidden) {
		t.Errorf("member review: %v", err)
	}
	// Returning needs a comment, and the failed call must change nothing.
	if _, err := e.items.Review(ctx, e.approver, b.ID, []Decision{
		{ItemID: its[0].ID, Decision: "approve"}, {ItemID: its[1].ID, Decision: "return"},
	}); err == nil {
		t.Fatal("return without comment must fail")
	}
	if got, _ := e.st.GetItem(ctx, its[0].ID); got.Status != domain.ItemPending {
		t.Fatalf("failed review was partially applied: %s", got.Status)
	}

	res, err := e.items.Review(ctx, e.approver, b.ID, []Decision{
		{ItemID: its[0].ID, Decision: "approve"}, {ItemID: its[1].ID, Decision: "approve"},
		{ItemID: its[2].ID, Decision: "return", Comment: "which model?"},
		{ItemID: its[3].ID, Decision: "reject", Comment: "not needed"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Batch.Status != domain.BatchReviewing {
		t.Fatalf("batch must wait for the returned item, got %s", res.Batch.Status)
	}

	// Resubmitting without editing is refused; after editing it works.
	returned, _ := e.st.GetItem(ctx, its[2].ID)
	if _, err := e.items.Resubmit(ctx, e.member, returned.ID, returned.Version); err == nil {
		t.Fatal("resubmit before editing must fail")
	}
	p, _ := domain.NewDecimal("5")
	edited, err := e.items.Update(ctx, e.member, returned.ID, returned.Version, ItemInput{
		Name: "c (model X)", Quantity: 1, Priority: 3, Purpose: "test", EstimatedUnitPrice: domain.Money{Amount: p, Currency: "USD"},
	})
	if err != nil {
		t.Fatal(err)
	}
	resub, err := e.items.Resubmit(ctx, e.member, edited.ID, edited.Version)
	if err != nil || resub.Status != domain.ItemPending {
		t.Fatalf("resubmit: %v %+v", err, resub)
	}
	res, err = e.items.Review(ctx, e.approver, b.ID, []Decision{{ItemID: resub.ID, Decision: "approve"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Batch.Status != domain.BatchOrdering {
		t.Fatalf("batch should move to ordering, got %s", res.Batch.Status)
	}
	// Decisions are final.
	if _, err := e.items.Review(ctx, e.approver, b.ID, []Decision{{ItemID: its[0].ID, Decision: "reject", Comment: "x"}}); err == nil {
		t.Error("reviewing in ordering must fail")
	}
}

func TestAllRejectedCompletesBatch(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	it := e.item(t, e.member, b.ID, "only")
	b, _ = e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActClose})
	// Team admin force-rejects.
	if _, err := e.items.ForceReject(ctx, e.member, it.ID, it.Version, "x"); !errors.Is(err, ErrForbidden) {
		t.Errorf("member force-reject: %v", err)
	}
	if _, err := e.items.ForceReject(ctx, e.admin, it.ID, it.Version, ""); err == nil {
		t.Error("force-reject needs a reason")
	}
	if _, err := e.items.ForceReject(ctx, e.admin, it.ID, it.Version, "duplicate"); err != nil {
		t.Fatal(err)
	}
	got, _ := e.st.GetBatch(ctx, b.ID)
	if got.Status != domain.BatchCompleted {
		t.Fatalf("all rejected should complete the batch, got %s", got.Status)
	}
}

// The deadline job closes collection exactly once and is a no-op afterwards or
// when the deadline was pushed out.
func TestCloseDueJob(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	e.item(t, e.member, b.ID, "x")

	if err := e.batches.CloseDue(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.st.GetBatch(ctx, b.ID); got.Status != domain.BatchCollecting {
		t.Fatalf("closed before the deadline: %s", got.Status)
	}

	e.batches.now = func() time.Time { return time.Now().Add(72 * time.Hour) }
	if err := e.batches.CloseDue(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := e.st.GetBatch(ctx, b.ID)
	if got.Status != domain.BatchReviewing {
		t.Fatalf("deadline passed: want reviewing, got %s", got.Status)
	}
	if err := e.batches.CloseDue(ctx, b.ID); err != nil { // idempotent
		t.Fatal(err)
	}
	if again, _ := e.st.GetBatch(ctx, b.ID); again.Version != got.Version {
		t.Error("second run changed the batch")
	}
}

func TestEmptyBatchAutoCancelsOnClose(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	b, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActClose})
	if err != nil || b.Status != domain.BatchCancelled || b.StatusReason != "no_items" {
		t.Fatalf("got %v %+v", err, b)
	}
}

// Proposals: any member proposes, only an admin handles it, only the proposer withdraws.
func TestProposalFlow(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b, err := e.batches.Create(ctx, e.member, e.team.ID, CreateBatchInput{Title: "Please buy"})
	if err != nil || b.Status != domain.BatchProposed {
		t.Fatalf("propose: %v %+v", err, b)
	}
	e.item(t, e.member, b.ID, "first") // proposer may add items while proposed
	if _, err := e.items.Add(ctx, e.approver, b.ID, ItemInput{}); !errors.Is(err, ErrForbidden) {
		t.Errorf("another member adding to a proposal: %v", err)
	}
	if _, err := e.batches.Transition(ctx, e.approver, b.ID, b.Version, TransitionInput{Action: domain.ActWithdrawProposal}); !errors.Is(err, ErrForbidden) {
		t.Errorf("non-proposer withdraw: %v", err)
	}
	if _, err := e.batches.Transition(ctx, e.member, b.ID, b.Version, TransitionInput{Action: domain.ActRejectProposal, Reason: "x"}); !errors.Is(err, ErrForbidden) {
		t.Errorf("member reject: %v", err)
	}
	if _, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActRejectProposal}); err == nil {
		t.Error("reject without a reason must fail")
	}
	got, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActRejectProposal, Reason: "no budget"})
	if err != nil || got.Status != domain.BatchProposalRejected {
		t.Fatalf("reject: %v %+v", err, got)
	}
}

// Acceptance criterion 6: visibility.
func TestVisibility(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	outsider := authz.Actor{UserID: bson.NewObjectID()}

	if _, _, err := e.batches.Get(ctx, outsider, b.ID); err != nil {
		t.Fatalf("public team batch should be readable: %v", err)
	}
	if _, err := e.items.Add(ctx, outsider, b.ID, ItemInput{}); !errors.Is(err, ErrForbidden) {
		t.Errorf("outsider write: %v", err)
	}
	if _, err := e.batches.Update(ctx, outsider, b.ID, b.Version, BatchPatch{}); !errors.Is(err, ErrForbidden) {
		t.Errorf("outsider update: %v", err)
	}

	vis := domain.VisibilityMembers
	if _, err := e.teams.Update(ctx, e.admin, e.team.ID, e.team.Version, TeamPatch{Visibility: &vis}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.batches.Get(ctx, outsider, b.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("members-only batch visible to outsider: %v", err)
	}
	page, err := e.batches.List(ctx, outsider, ListBatchesInput{})
	if err != nil || len(page.Items) != 0 {
		t.Errorf("outsider list: %v %d", err, len(page.Items))
	}
	if page, _ := e.batches.List(ctx, e.member, ListBatchesInput{}); len(page.Items) != 1 {
		t.Errorf("member list: %d", len(page.Items))
	}
}

// Spec §8.1: when a member leaves, their batch assignments are removed.
func TestRemovedMemberLosesAssignments(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t) // e.member is the receiver

	m, err := e.st.GetMembership(ctx, e.team.ID, e.member.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.teams.RemoveMember(ctx, e.admin, e.team.ID, e.member.UserID, m.Version); err != nil {
		t.Fatal(err)
	}
	got, _ := e.st.GetBatch(ctx, b.ID)
	for _, id := range got.Assignments.Receivers {
		if id == e.member.UserID {
			t.Fatal("departed member is still an assigned receiver")
		}
	}
	evs, _ := audit.New(e.st.DB).ForBatch(ctx, b.ID, 100)
	var audited bool
	for _, ev := range evs {
		if ev.Action == "batch.assignee_removed" {
			audited = true
		}
	}
	if !audited {
		t.Error("assignee removal was not audited")
	}
	// A stale version must not remove anyone.
	if err := e.teams.RemoveMember(ctx, e.admin, e.team.ID, e.approver.UserID, 999); !errors.Is(err, ErrVersionConflict) {
		t.Errorf("stale remove: %v", err)
	}
}
