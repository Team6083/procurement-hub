package domain

import (
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func fullAssign() Assignments {
	id := bson.NewObjectID()
	return Assignments{Approvers: []bson.ObjectID{id}, Purchasers: []bson.ObjectID{id}}
}

func TestApplyAction(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	future, past := now.Add(time.Hour), now.Add(-time.Hour)
	partial := Assignments{}

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
		{"close with only decided items", BatchCollecting, ActionInput{Action: ActClose, Items: ItemCounts{ItemApproved: 1, ItemRejected: 1}}, BatchReviewing, "", nil},
		{"close empty auto-cancels", BatchCollecting, ActionInput{Action: ActClose}, BatchCancelled, "no_items", nil},
		{"reopen ok", BatchReviewing, ActionInput{Action: ActReopen, Deadline: &future}, BatchCollecting, "", nil},
		{"reopen past deadline", BatchReviewing, ActionInput{Action: ActReopen, Deadline: &past}, "", "", ErrDeadlinePast},
		{"cancel collecting", BatchCollecting, ActionInput{Action: ActCancel, Reason: "x"}, BatchCancelled, "x", nil},
		{"cancel needs reason", BatchCollecting, ActionInput{Action: ActCancel}, "", "", ErrReasonRequired},
		{"cancel purchasing forbidden", BatchPurchasing, ActionInput{Action: ActCancel, Reason: "x"}, "", "", ErrInvalidTransition},
		{"cancel completed forbidden", BatchCompleted, ActionInput{Action: ActCancel, Reason: "x"}, "", "", ErrInvalidTransition},
		{"reject proposal", BatchProposed, ActionInput{Action: ActRejectProposal, Reason: "no"}, BatchProposalRejected, "no", nil},
		{"reject proposal needs reason", BatchProposed, ActionInput{Action: ActRejectProposal}, "", "", ErrReasonRequired},
		{"reject non-proposal", BatchDraft, ActionInput{Action: ActRejectProposal, Reason: "no"}, "", "", ErrInvalidTransition},
		{"withdraw by proposer", BatchProposed, ActionInput{Action: ActWithdrawProposal, ActorIsProposer: true}, BatchCancelled, "", nil},
		{"restore rejected proposal", BatchProposalRejected, ActionInput{Action: ActRestoreProposal, Reason: "x"}, BatchProposed, "", nil},
		{"restore withdrawn proposal", BatchCancelled, ActionInput{Action: ActRestoreProposal, Reason: "x", StatusBeforeCancel: BatchProposed}, BatchProposed, "", nil},
		{"uncancel withdrawn proposal is invalid", BatchCancelled, ActionInput{Action: ActUncancel, Reason: "x", StatusBeforeCancel: BatchProposed}, "", "", ErrInvalidTransition},
		{"uncancel reviewing", BatchCancelled, ActionInput{Action: ActUncancel, Reason: "x", StatusBeforeCancel: BatchReviewing}, BatchReviewing, "", nil},
		{"uncancel collecting with the old deadline passed needs a new one", BatchCancelled, ActionInput{Action: ActUncancel, Reason: "x", StatusBeforeCancel: BatchCollecting, Deadline: &past}, "", "", ErrDeadlinePast},
		{"uncancel collecting without any deadline needs one", BatchCancelled, ActionInput{Action: ActUncancel, Reason: "x", StatusBeforeCancel: BatchCollecting}, "", "", ErrDeadlineRequired},
		{"uncancel collecting with deadline", BatchCancelled, ActionInput{Action: ActUncancel, Reason: "x", StatusBeforeCancel: BatchCollecting, Deadline: &future}, BatchCollecting, "", nil},
		{"confirm with pending", BatchReviewing, ActionInput{Action: ActConfirmReview, Items: ItemCounts{ItemPending: 1}}, "", "", ErrItemsUndecided},
		{"confirm ok", BatchReviewing, ActionInput{Action: ActConfirmReview, Items: ItemCounts{ItemApproved: 2}}, BatchReviewing, "", nil},
		{"cancel after confirmation forbidden", BatchReceiving, ActionInput{Action: ActCancel, Reason: "x"}, "", "", ErrInvalidTransition},
		{"unconfirm", BatchPurchasing, ActionInput{Action: ActUnconfirmReview, Reason: "x"}, BatchReviewing, "", nil},
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

func TestDeriveFulfillment(t *testing.T) {
	ln := func(ss ...LineStatus) []LineView {
		var out []LineView
		for _, s := range ss {
			out = append(out, LineView{Status: s})
		}
		return out
	}
	tests := []struct {
		name string
		in   FulfillmentInput
		want Fulfillment
	}{
		{"external wins", FulfillmentInput{External: true, Unpurchasable: true}, FulfillExternal},
		{"unpurchasable", FulfillmentInput{Unpurchasable: true, Lines: ln(LineDraft)}, FulfillUnpurchasable},
		{"not ordered", FulfillmentInput{ToPurchaseQty: 3}, FulfillNotOrdered},
		{"partially ordered by remaining qty", FulfillmentInput{ToPurchaseQty: 4, Lines: ln(LineOrdered)}, FulfillPartiallyOrdered},
		{"partially ordered by draft line", FulfillmentInput{Lines: ln(LineOrdered, LineDraft)}, FulfillPartiallyOrdered},
		{"unpurchasable remaining with placed line", FulfillmentInput{Unpurchasable: true, Lines: ln(LineOrdered)}, FulfillOrdered},
		{"received", FulfillmentInput{Lines: ln(LineReceived, LineReceived)}, FulfillReceived},
		{"closed", FulfillmentInput{Lines: ln(LineReceived, LineShortAccepted)}, FulfillClosed},
		{"partially received", FulfillmentInput{Lines: ln(LineReceived, LineOrdered)}, FulfillPartiallyReceived},
		{"ordered", FulfillmentInput{Lines: ln(LineOrdered)}, FulfillOrdered},
	}
	for _, tt := range tests {
		if got := DeriveFulfillment(tt.in); got != tt.want {
			t.Errorf("%s: got %s want %s", tt.name, got, tt.want)
		}
	}
}

func TestDeriveBatchStatus(t *testing.T) {
	tests := []struct {
		in   []Fulfillment
		want BatchStatus
	}{
		{nil, BatchCompleted},
		{[]Fulfillment{FulfillNotOrdered, FulfillReceived}, BatchPurchasing},
		{[]Fulfillment{FulfillPartiallyOrdered}, BatchPurchasing},
		{[]Fulfillment{FulfillOrdered, FulfillReceived}, BatchReceiving},
		{[]Fulfillment{FulfillReceived, FulfillClosed, FulfillUnpurchasable, FulfillExternal}, BatchCompleted},
	}
	for _, tt := range tests {
		if got := DeriveBatchStatus(tt.in); got != tt.want {
			t.Errorf("%v: got %s want %s", tt.in, got, tt.want)
		}
	}
}
