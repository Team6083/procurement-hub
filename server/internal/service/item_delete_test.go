package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

func TestDeleteNeverReviewedItem(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	first := e.item(t, e.member, b.ID, "first")
	second := e.item(t, e.member, b.ID, "second")

	if err := e.items.Delete(ctx, e.approver, first.ID, first.Version); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other member: want forbidden, got %v", err)
	}
	if err := e.items.Delete(ctx, e.member, first.ID, first.Version); err != nil {
		t.Fatalf("delete in collecting: %v", err)
	}
	if _, err := e.st.GetItem(ctx, first.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("item must be gone, got %v", err)
	}
	// The audit event keeps the pre-delete content.
	pg, err := e.items.audit.PageForObject(ctx, "item", first.ID.Hex(), bson.ObjectID{}, 50, false)
	if err != nil {
		t.Fatal(err)
	}
	var snap domain.Item
	found := false
	for _, ev := range pg.Events {
		if ev.Action == "item.deleted" && len(ev.Changes) == 1 {
			raw, err := bson.Marshal(ev.Changes[0].From)
			if err != nil || bson.Unmarshal(raw, &snap) != nil {
				t.Fatalf("snapshot not decodable: %v", err)
			}
			found = true
		}
	}
	if !found || snap.Name != "first" || snap.SeqNo != first.SeqNo {
		t.Fatalf("item.deleted audit with snapshot missing: %+v", pg.Events)
	}
	// A stale version is a conflict.
	if err := e.items.Delete(ctx, e.admin, second.ID, second.Version+1); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale version: want conflict, got %v", err)
	}
	// Deleting the highest seqNo (as admin) must not let it be reused.
	if err := e.items.Delete(ctx, e.admin, second.ID, second.Version); err != nil {
		t.Fatalf("admin delete: %v", err)
	}
	third := e.item(t, e.member, b.ID, "third")
	if third.SeqNo != second.SeqNo+1 {
		t.Fatalf("seqNo reused: first=%d second=%d third=%d", first.SeqNo, second.SeqNo, third.SeqNo)
	}
}

func TestDeleteRefusedOnceReviewed(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	b := e.openBatch(t)
	it := e.item(t, e.member, b.ID, "x")
	other := e.item(t, e.member, b.ID, "y")
	b, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActClose})
	if err != nil || b.Status != domain.BatchReviewing {
		t.Fatalf("close: %v %+v", err, b)
	}
	var rule *RuleError
	if err := e.items.Delete(ctx, e.member, other.ID, other.Version); !errors.As(err, &rule) || rule.Code != "item_not_deletable" {
		t.Fatalf("reviewing batch: want item_not_deletable, got %v", err)
	}
	res, err := e.items.Review(ctx, e.approver, b.ID, []Decision{{ItemID: it.ID, Decision: "approve"}})
	if err != nil {
		t.Fatal(err)
	}
	// Undo clears the decision but not firstReviewedAt; reopening makes the batch collecting again.
	undone, err := e.items.UndoReview(ctx, e.approver, it.ID, res.Items[0].Version, "oops")
	if err != nil || undone.Review != nil || undone.FirstReviewedAt == nil {
		t.Fatalf("undo: %v %+v", err, undone)
	}
	got, _ := e.st.GetBatch(ctx, b.ID)
	dl := time.Now().Add(96 * time.Hour)
	if _, err := e.batches.Transition(ctx, e.admin, b.ID, got.Version, TransitionInput{Action: domain.ActReopen, Deadline: &dl}); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if err := e.items.Delete(ctx, e.member, it.ID, undone.Version); !errors.As(err, &rule) || rule.Code != "item_not_deletable" {
		t.Fatalf("reviewed item after reopen: want item_not_deletable, got %v", err)
	}
}
