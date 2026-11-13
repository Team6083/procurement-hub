package domain

import (
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func fullAssign() Assignments {
	id := bson.NewObjectID()
	return Assignments{Approvers: []bson.ObjectID{id}, Purchasers: []bson.ObjectID{id}, Receivers: []bson.ObjectID{id}}
}

func TestApplyAction(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	future, past := now.Add(time.Hour), now.Add(-time.Hour)
	partial := Assignments{Approvers: []bson.ObjectID{bson.NewObjectID()}}

	tests := []struct {
		name string
		from BatchStatus
		in   ActionInput
		to   BatchStatus
		rsn  string
		err  error
	}{
		{"open draft", BatchDraft, ActionInput{Action: ActOpen, Deadline: &future, Assignments: fullAssign()}, BatchCollecting, "", nil},
		{"open proposed", BatchProposed, ActionInput{Action: ActOpen, Deadline: &future, Assignments: fullAssign()}, BatchCollecting, "", nil},
		{"open incomplete assignments", BatchDraft, ActionInput{Action: ActOpen, Deadline: &future, Assignments: partial}, "", "", ErrAssignmentsIncomplete},
		{"open without deadline", BatchDraft, ActionInput{Action: ActOpen, Assignments: fullAssign()}, "", "", ErrDeadlineRequired},
		{"open past deadline", BatchDraft, ActionInput{Action: ActOpen, Deadline: &past, Assignments: fullAssign()}, "", "", ErrDeadlinePast},
		{"open from collecting", BatchCollecting, ActionInput{Action: ActOpen, Deadline: &future, Assignments: fullAssign()}, "", "", ErrInvalidTransition},
		{"start review ok", BatchDraft, ActionInput{Action: ActStartReview, Assignments: fullAssign(), Items: ItemCounts{ItemPending: 1}}, BatchReviewing, "", nil},
		{"start review no pending", BatchDraft, ActionInput{Action: ActStartReview, Assignments: fullAssign()}, "", "", ErrNoPendingItems},
		{"close with items", BatchCollecting, ActionInput{Action: ActClose, Items: ItemCounts{ItemPending: 2}}, BatchReviewing, "", nil},
		{"close with only returned", BatchCollecting, ActionInput{Action: ActClose, Items: ItemCounts{ItemReturned: 1}}, BatchReviewing, "", nil},
		{"close empty auto-cancels", BatchCollecting, ActionInput{Action: ActClose}, BatchCancelled, "no_items", nil},
		{"reopen ok", BatchReviewing, ActionInput{Action: ActReopen, Deadline: &future}, BatchCollecting, "", nil},
		{"reopen past deadline", BatchReviewing, ActionInput{Action: ActReopen, Deadline: &past}, "", "", ErrDeadlinePast},
		{"cancel collecting", BatchCollecting, ActionInput{Action: ActCancel, Reason: "x"}, BatchCancelled, "x", nil},
		{"cancel needs reason", BatchCollecting, ActionInput{Action: ActCancel}, "", "", ErrReasonRequired},
		{"cancel ordering forbidden", BatchOrdering, ActionInput{Action: ActCancel, Reason: "x"}, "", "", ErrInvalidTransition},
		{"cancel completed forbidden", BatchCompleted, ActionInput{Action: ActCancel, Reason: "x"}, "", "", ErrInvalidTransition},
		{"reject proposal", BatchProposed, ActionInput{Action: ActRejectProposal, Reason: "no"}, BatchProposalRejected, "no", nil},
		{"reject proposal needs reason", BatchProposed, ActionInput{Action: ActRejectProposal}, "", "", ErrReasonRequired},
		{"reject non-proposal", BatchDraft, ActionInput{Action: ActRejectProposal, Reason: "no"}, "", "", ErrInvalidTransition},
		{"withdraw by proposer", BatchProposed, ActionInput{Action: ActWithdrawProposal, ActorIsProposer: true}, BatchCancelled, "", nil},
		{"withdraw by other", BatchProposed, ActionInput{Action: ActWithdrawProposal}, "", "", ErrNotProposer},
		{"unknown action", BatchDraft, ActionInput{Action: "explode"}, "", "", ErrInvalidTransition},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.in.Now = now
			got, err := ApplyAction(tt.from, tt.in)
			if tt.err != nil {
				if !errors.Is(err, tt.err) {
					t.Fatalf("err = %v, want %v", err, tt.err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.To != tt.to || got.Reason != tt.rsn {
				t.Fatalf("got %+v, want to=%s reason=%q", got, tt.to, tt.rsn)
			}
		})
	}
}

func TestAutoTransition(t *testing.T) {
	tests := []struct {
		name    string
		from    BatchStatus
		c       ItemCounts
		to      BatchStatus
		changed bool
	}{
		{"reviewing: pending blocks", BatchReviewing, ItemCounts{ItemPending: 1, ItemApproved: 5}, BatchReviewing, false},
		{"reviewing: returned blocks", BatchReviewing, ItemCounts{ItemReturned: 1, ItemApproved: 5}, BatchReviewing, false},
		{"reviewing: all decided -> ordering", BatchReviewing, ItemCounts{ItemApproved: 18, ItemRejected: 1}, BatchOrdering, true},
		{"reviewing: all rejected -> completed", BatchReviewing, ItemCounts{ItemRejected: 3}, BatchCompleted, true},
		{"ordering: unordered approved blocks", BatchOrdering, ItemCounts{ItemApproved: 1, ItemOrdered: 2}, BatchOrdering, false},
		{"ordering: all handled -> receiving", BatchOrdering, ItemCounts{ItemOrdered: 2, ItemUnpurchasable: 1}, BatchReceiving, true},
		{"ordering: all unpurchasable -> completed", BatchOrdering, ItemCounts{ItemUnpurchasable: 2}, BatchCompleted, true},
		{"receiving: open items block", BatchReceiving, ItemCounts{ItemReceived: 3, ItemPartiallyReceived: 1}, BatchReceiving, false},
		{"receiving: open exception blocks", BatchReceiving, ItemCounts{ItemReceived: 3, ItemException: 1}, BatchReceiving, false},
		{"receiving: all closed -> completed", BatchReceiving, ItemCounts{ItemReceived: 2, ItemAcceptedShort: 1, ItemNotObtained: 1}, BatchCompleted, true},
		{"collecting: no auto", BatchCollecting, ItemCounts{ItemPending: 1}, BatchCollecting, false},
		{"completed stays", BatchCompleted, ItemCounts{}, BatchCompleted, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, changed := AutoTransition(tt.from, tt.c)
			if got != tt.to || changed != tt.changed {
				t.Fatalf("got %s,%v want %s,%v", got, changed, tt.to, tt.changed)
			}
		})
	}
}
