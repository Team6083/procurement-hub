package domain

import (
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type BatchStatus string

const (
	BatchProposed         BatchStatus = "proposed"
	BatchProposalRejected BatchStatus = "proposal_rejected"
	BatchDraft            BatchStatus = "draft"
	BatchCollecting       BatchStatus = "collecting"
	BatchReviewing        BatchStatus = "reviewing"
	BatchPurchasing       BatchStatus = "purchasing"
	BatchReceiving        BatchStatus = "receiving"
	BatchCompleted        BatchStatus = "completed"
	BatchCancelled        BatchStatus = "cancelled"
)

// cancellable: before review confirmation (spec §10.1).
func (s BatchStatus) cancellable() bool {
	return s == BatchDraft || s == BatchCollecting || s == BatchReviewing
}

// PostConfirmation reports statuses derived from item progress.
func (s BatchStatus) PostConfirmation() bool {
	return s == BatchPurchasing || s == BatchReceiving || s == BatchCompleted
}

type BatchAction string

const (
	ActOpen             BatchAction = "open"
	ActStartReview      BatchAction = "start_review"
	ActClose            BatchAction = "close"
	ActReopen           BatchAction = "reopen"
	ActCancel           BatchAction = "cancel"
	ActUncancel         BatchAction = "uncancel"
	ActRejectProposal   BatchAction = "reject_proposal"
	ActWithdrawProposal BatchAction = "withdraw_proposal"
	ActRestoreProposal  BatchAction = "restore_proposal"
	ActConfirmReview    BatchAction = "confirm_review"
	ActUnconfirmReview  BatchAction = "unconfirm_review"
)

// Undoes names the action that reverts a given action (only for those with an undo).
func (a BatchAction) IsUndo() bool {
	return a == ActUncancel || a == ActRestoreProposal || a == ActUnconfirmReview
}

type Assignments struct {
	Approvers  []bson.ObjectID `bson:"approvers" json:"approvers"`
	Purchasers []bson.ObjectID `bson:"purchasers" json:"purchasers"`
}

// Complete is true when there is at least one approver (spec §10.1).
// Purchasers are optional.
func (a Assignments) Complete() bool { return len(a.Approvers) > 0 }

// ReviewConfirmation records the manual review confirmation (spec §9.1).
type ReviewConfirmation struct {
	By              bson.ObjectID `bson:"by" json:"by"`
	At              time.Time     `bson:"at" json:"at"`
	PurchaseOutside bool          `bson:"purchaseOutside" json:"purchaseOutside"`
}

type Batch struct {
	ID                 bson.ObjectID       `bson:"_id,omitempty" json:"id"`
	TeamID             bson.ObjectID       `bson:"teamId" json:"teamId"`
	Number             int                 `bson:"number" json:"number"`
	Title              string              `bson:"title" json:"title"`
	Description        string              `bson:"description" json:"description"`
	Status             BatchStatus         `bson:"status" json:"status"`
	StatusBeforeCancel BatchStatus         `bson:"statusBeforeCancel,omitempty" json:"statusBeforeCancel,omitempty"`
	Origin             string              `bson:"origin" json:"origin"` // created | proposed
	CreatedBy          bson.ObjectID       `bson:"createdBy" json:"createdBy"`
	Deadline           *time.Time          `bson:"deadline" json:"deadline"`
	Assignments        Assignments         `bson:"assignments" json:"assignments"`
	ReviewConfirmation *ReviewConfirmation `bson:"reviewConfirmation,omitempty" json:"reviewConfirmation"`
	VisibilityOverride Visibility          `bson:"visibilityOverride,omitempty" json:"visibilityOverride"`
	ItemCounter        int                 `bson:"itemCounter" json:"-"`
	StatusReason       string              `bson:"statusReason,omitempty" json:"statusReason"`
	StatusChangedAt    time.Time           `bson:"statusChangedAt" json:"statusChangedAt"`
	CreatedAt          time.Time           `bson:"createdAt" json:"createdAt"`
	UpdatedAt          time.Time           `bson:"updatedAt" json:"updatedAt"`
	Version            int64               `bson:"version" json:"version"`
}

// ItemCounts summarises non-withdrawn items by status for guards.
type ItemCounts map[ItemStatus]int

func (c ItemCounts) sum(ss ...ItemStatus) int {
	n := 0
	for _, s := range ss {
		n += c[s]
	}
	return n
}

// Undecided counts items still waiting for a review decision.
func (c ItemCounts) Undecided() int { return c.sum(ItemPending, ItemReturned) }

// ActionInput is everything a manual transition guard needs.
type ActionInput struct {
	Action BatchAction
	Now    time.Time
	// Deadline is the batch's deadline for open, or the new deadline for reopen
	// and for uncancel of a batch that was collecting.
	Deadline           *time.Time
	Assignments        Assignments
	Reason             string
	Items              ItemCounts
	StatusBeforeCancel BatchStatus
	// ActorIsProposer matters only for withdraw_proposal.
	ActorIsProposer bool
}

// ActionResult is the outcome of a manual transition.
type ActionResult struct {
	To     BatchStatus
	Reason string // set when the batch cancels itself (e.g. "no_items")
	// StatusBeforeCancel is recorded when To is cancelled.
	StatusBeforeCancel BatchStatus
	// SetDeadline is true when the action stores in.Deadline.
	SetDeadline bool
}

// Sentinel business-rule errors with stable codes for the API layer.
var (
	ErrAssignmentsIncomplete = errors.New("assignments_incomplete")
	ErrDeadlineRequired      = errors.New("deadline_required")
	ErrDeadlinePast          = errors.New("deadline_not_in_future")
	ErrNoPendingItems        = errors.New("no_pending_items")
	ErrReasonRequired        = errors.New("reason_required")
	ErrNotProposer           = errors.New("not_proposer")
	ErrItemsUndecided        = errors.New("items_undecided")
)

// ApplyAction evaluates a manual batch transition (spec §10.1). Permission
// checks and blocker checks that need other collections happen in the service
// layer; this only enforces state and guards.
func ApplyAction(from BatchStatus, in ActionInput) (ActionResult, error) {
	bad := func() (ActionResult, error) {
		return ActionResult{}, fmt.Errorf("%w: %s on %s batch", ErrInvalidTransition, in.Action, from)
	}
	futureDeadline := func() error {
		if in.Deadline == nil {
			return ErrDeadlineRequired
		}
		if !in.Deadline.After(in.Now) {
			return ErrDeadlinePast
		}
		return nil
	}
	switch in.Action {
	case ActOpen:
		if from != BatchProposed && from != BatchDraft {
			return bad()
		}
		if !in.Assignments.Complete() {
			return ActionResult{}, ErrAssignmentsIncomplete
		}
		if err := futureDeadline(); err != nil {
			return ActionResult{}, err
		}
		return ActionResult{To: BatchCollecting}, nil

	case ActStartReview:
		if from != BatchProposed && from != BatchDraft {
			return bad()
		}
		if !in.Assignments.Complete() {
			return ActionResult{}, ErrAssignmentsIncomplete
		}
		if in.Items[ItemPending] < 1 {
			return ActionResult{}, ErrNoPendingItems
		}
		return ActionResult{To: BatchReviewing}, nil

	case ActClose:
		if from != BatchCollecting {
			return bad()
		}
		if in.Items.sum(ItemPending, ItemReturned) == 0 {
			return ActionResult{To: BatchCancelled, Reason: "no_items", StatusBeforeCancel: BatchCollecting}, nil
		}
		return ActionResult{To: BatchReviewing}, nil

	case ActReopen:
		if from != BatchReviewing {
			return bad()
		}
		if err := futureDeadline(); err != nil {
			return ActionResult{}, err
		}
		return ActionResult{To: BatchCollecting, SetDeadline: true}, nil

	case ActCancel:
		if !from.cancellable() {
			return bad()
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		return ActionResult{To: BatchCancelled, Reason: in.Reason, StatusBeforeCancel: from}, nil

	case ActUncancel:
		if from != BatchCancelled || !in.StatusBeforeCancel.cancellable() {
			return bad() // withdrawn proposals use restore_proposal
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		res := ActionResult{To: in.StatusBeforeCancel}
		if in.StatusBeforeCancel == BatchCollecting {
			// The deadline may have passed meanwhile; a new one is then required.
			if in.Deadline != nil {
				if err := futureDeadline(); err != nil {
					return ActionResult{}, err
				}
				res.SetDeadline = true
			} else if err := futureDeadline(); err != nil {
				return ActionResult{}, err
			}
		}
		return res, nil

	case ActRejectProposal:
		if from != BatchProposed {
			return bad()
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		return ActionResult{To: BatchProposalRejected, Reason: in.Reason}, nil

	case ActWithdrawProposal:
		if from != BatchProposed {
			return bad()
		}
		if !in.ActorIsProposer {
			return ActionResult{}, ErrNotProposer
		}
		return ActionResult{To: BatchCancelled, StatusBeforeCancel: BatchProposed}, nil

	case ActRestoreProposal:
		if !(from == BatchProposalRejected || (from == BatchCancelled && in.StatusBeforeCancel == BatchProposed)) {
			return bad()
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		return ActionResult{To: BatchProposed}, nil

	case ActConfirmReview:
		if from != BatchReviewing {
			return bad()
		}
		if in.Items.sum(ItemPending, ItemReturned) > 0 {
			return ActionResult{}, ErrItemsUndecided
		}
		return ActionResult{To: BatchReviewing}, nil // service derives the real status

	case ActUnconfirmReview:
		if !from.PostConfirmation() {
			return bad()
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		return ActionResult{To: BatchReviewing}, nil
	}
	return ActionResult{}, fmt.Errorf("%w: unknown action %q", ErrInvalidTransition, in.Action)
}
