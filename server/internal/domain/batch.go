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
	BatchOrdering         BatchStatus = "ordering"
	BatchReceiving        BatchStatus = "receiving"
	BatchCompleted        BatchStatus = "completed"
	BatchCancelled        BatchStatus = "cancelled"
)

// BeforeOrdering reports statuses from which an admin may still cancel.
func (s BatchStatus) cancellable() bool {
	return s == BatchDraft || s == BatchCollecting || s == BatchReviewing
}

type BatchAction string

const (
	ActOpen             BatchAction = "open"
	ActStartReview      BatchAction = "start_review"
	ActClose            BatchAction = "close"
	ActReopen           BatchAction = "reopen"
	ActCancel           BatchAction = "cancel"
	ActRejectProposal   BatchAction = "reject_proposal"
	ActWithdrawProposal BatchAction = "withdraw_proposal"
)

type Assignments struct {
	Approvers  []bson.ObjectID `bson:"approvers" json:"approvers"`
	Purchasers []bson.ObjectID `bson:"purchasers" json:"purchasers"`
	Receivers  []bson.ObjectID `bson:"receivers" json:"receivers"`
}

// Complete is true when each role has at least one assignee.
func (a Assignments) Complete() bool {
	return len(a.Approvers) > 0 && len(a.Purchasers) > 0 && len(a.Receivers) > 0
}

type Batch struct {
	ID                 bson.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID             bson.ObjectID `bson:"teamId" json:"teamId"`
	Number             int           `bson:"number" json:"number"`
	Title              string        `bson:"title" json:"title"`
	Description        string        `bson:"description" json:"description"`
	Status             BatchStatus   `bson:"status" json:"status"`
	Origin             string        `bson:"origin" json:"origin"` // created | proposed
	CreatedBy          bson.ObjectID `bson:"createdBy" json:"createdBy"`
	Deadline           *time.Time    `bson:"deadline" json:"deadline"`
	Assignments        Assignments   `bson:"assignments" json:"assignments"`
	VisibilityOverride Visibility    `bson:"visibilityOverride,omitempty" json:"visibilityOverride"`
	ItemCounter        int           `bson:"itemCounter" json:"-"`
	OrderCounter       int           `bson:"orderCounter" json:"-"` // source of order numbers
	StatusReason       string        `bson:"statusReason,omitempty" json:"statusReason"`
	StatusChangedAt    time.Time     `bson:"statusChangedAt" json:"statusChangedAt"`
	CreatedAt          time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt          time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version            int64         `bson:"version" json:"version"`
}

// ItemCounts summarises non-withdrawn items by status for guards and auto transitions.
type ItemCounts map[ItemStatus]int

func (c ItemCounts) sum(ss ...ItemStatus) int {
	n := 0
	for _, s := range ss {
		n += c[s]
	}
	return n
}

// ActionInput is everything a manual transition guard needs.
type ActionInput struct {
	Action BatchAction
	Now    time.Time
	// Deadline is the batch's deadline for open, or the new deadline for reopen.
	Deadline    *time.Time
	Assignments Assignments
	Reason      string
	Items       ItemCounts
	// ActorIsProposer matters only for withdraw_proposal.
	ActorIsProposer bool
}

// ActionResult is the outcome of a manual transition.
type ActionResult struct {
	To     BatchStatus
	Reason string // set when the batch cancels itself (e.g. "no_items")
}

// Sentinel business-rule errors with stable codes for the API layer.
var (
	ErrAssignmentsIncomplete = errors.New("assignments_incomplete")
	ErrDeadlineRequired      = errors.New("deadline_required")
	ErrDeadlinePast          = errors.New("deadline_not_in_future")
	ErrNoPendingItems        = errors.New("no_pending_items")
	ErrReasonRequired        = errors.New("reason_required")
	ErrNotProposer           = errors.New("not_proposer")
)

// ApplyAction evaluates a manual batch transition (spec §10.1). Permission
// checks happen in the service layer; this only enforces state and guards.
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
			return ActionResult{To: BatchCancelled, Reason: "no_items"}, nil
		}
		return ActionResult{To: BatchReviewing}, nil

	case ActReopen:
		if from != BatchReviewing {
			return bad()
		}
		if err := futureDeadline(); err != nil {
			return ActionResult{}, err
		}
		return ActionResult{To: BatchCollecting}, nil

	case ActCancel:
		if !from.cancellable() {
			return bad()
		}
		if in.Reason == "" {
			return ActionResult{}, ErrReasonRequired
		}
		return ActionResult{To: BatchCancelled, Reason: in.Reason}, nil

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
		return ActionResult{To: BatchCancelled}, nil
	}
	return ActionResult{}, fmt.Errorf("%w: unknown action %q", ErrInvalidTransition, in.Action)
}

// AutoTransition evaluates the automatic transitions of spec §10.1 for the
// current status and item counts (withdrawn items already excluded). It
// returns the final status after following any chain, and whether it changed.
func AutoTransition(status BatchStatus, c ItemCounts) (BatchStatus, bool) {
	cur := status
	for {
		next := autoStep(cur, c)
		if next == cur {
			return cur, cur != status
		}
		cur = next
	}
}

var (
	// closedReceiving: items that no longer need receiving attention.
	receivingOpen = []ItemStatus{ItemOrdered, ItemPartiallyReceived, ItemException}
	// placed: items that have been ordered at some point.
	placed = []ItemStatus{ItemOrdered, ItemPartiallyReceived, ItemReceived, ItemException, ItemAcceptedShort, ItemNotObtained}
)

func autoStep(s BatchStatus, c ItemCounts) BatchStatus {
	switch s {
	case BatchReviewing:
		if c.sum(ItemPending, ItemReturned) > 0 {
			return s
		}
		if c[ItemApproved] > 0 {
			return BatchOrdering
		}
		return BatchCompleted // everything rejected (or withdrawn)
	case BatchOrdering:
		if c[ItemApproved] > 0 { // approved items not yet ordered or marked unpurchasable
			return s
		}
		if c.sum(placed...) > 0 {
			return BatchReceiving
		}
		return BatchCompleted // all approved items unpurchasable
	case BatchReceiving:
		if c.sum(receivingOpen...) > 0 {
			return s
		}
		return BatchCompleted
	}
	return s
}
