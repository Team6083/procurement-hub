package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

type Tasks struct{ st *store.Store }

func NewTasks(st *store.Store) *Tasks { return &Tasks{st: st} }

// BatchTask is a batch needing the caller's attention, with a count where relevant.
type BatchTask struct {
	Batch domain.Batch `json:"batch"`
	Count int          `json:"count"`
}

// VendorTask counts items to purchase for one vendor (nil VendorID and Vendor: "other").
type VendorTask struct {
	VendorID *bson.ObjectID `json:"vendorId"`
	Vendor   *string        `json:"vendor"`
	// Inactive is true for a vendor that was deactivated; its items still form its own group.
	Inactive bool `json:"inactive"`
	Count    int  `json:"count"`
	// MyBatches counts those in batches the caller is assigned to as purchaser.
	MyBatches int `json:"myBatches"`
}

// CountTask is a plain counter.
type CountTask struct {
	Count int `json:"count"`
}

// OwnedCountTask is a counter that also reports how many of the counted things
// belong to vendor orders the caller owns (spec §16.2).
type OwnedCountTask struct {
	Count int `json:"count"`
	Mine  int `json:"mine"`
}

// MyTasks is the "my tasks" payload (spec §16.2). Role-specific parts are nil
// for callers without the role.
type MyTasks struct {
	ProposalsToHandle []BatchTask
	ItemsToReview     []BatchTask
	ReturnedItems     []domain.Item
	ReviewsToConfirm  []BatchTask
	ItemsToPurchase   []VendorTask    // purchasers
	DraftVendorOrders *OwnedCountTask // purchasers
	OpenProblems      *OwnedCountTask // purchasers
	LinesToClose      *OwnedCountTask // purchasers
	DeliveriesToMatch *CountTask      // purchasers and receivers
}

func (s *Tasks) For(ctx context.Context, actor authz.Actor) (*MyTasks, error) {
	out := &MyTasks{
		ProposalsToHandle: []BatchTask{}, ItemsToReview: []BatchTask{}, ReturnedItems: []domain.Item{},
		ReviewsToConfirm: []BatchTask{},
	}

	var adminTeams []bson.ObjectID
	for id, r := range actor.TeamRoles {
		if r == domain.RoleAdmin {
			adminTeams = append(adminTeams, id)
		}
	}
	if len(adminTeams) > 0 {
		bs, err := s.st.BatchesByStatus(ctx, domain.BatchProposed, adminTeams)
		if err != nil {
			return nil, err
		}
		for _, b := range bs {
			out.ProposalsToHandle = append(out.ProposalsToHandle, BatchTask{Batch: b})
		}
	}

	var teamIDs []bson.ObjectID
	for id := range actor.TeamRoles {
		teamIDs = append(teamIDs, id)
	}
	if len(teamIDs) > 0 {
		bs, err := s.st.BatchesByStatus(ctx, domain.BatchReviewing, teamIDs)
		if err != nil {
			return nil, err
		}
		for _, b := range bs {
			if !actor.HasBatchRole(b.TeamID, authzAssignments(b.Assignments), authz.BatchApprover) {
				continue
			}
			counts, err := s.st.ItemCounts(ctx, b.ID)
			if err != nil {
				return nil, err
			}
			if n := counts[domain.ItemPending]; n > 0 {
				out.ItemsToReview = append(out.ItemsToReview, BatchTask{Batch: b, Count: n})
			}
			if counts.Undecided() == 0 {
				out.ReviewsToConfirm = append(out.ReviewsToConfirm, BatchTask{Batch: b, Count: counts[domain.ItemApproved] + counts[domain.ItemRejected]})
			}
		}
	}

	returned, err := s.st.ItemsByRequester(ctx, actor.UserID, domain.ItemReturned)
	if err != nil {
		return nil, err
	}
	if returned != nil {
		out.ReturnedItems = returned
	}
	if actor.IsPurchaser {
		if out.ItemsToPurchase, err = s.itemsToPurchase(ctx, actor); err != nil {
			return nil, err
		}
		drafts, err := s.st.CountDraftOrders(ctx)
		if err != nil {
			return nil, err
		}
		toClose, err := s.st.LinesToClose(ctx)
		if err != nil {
			return nil, err
		}
		open, err := s.st.CountOpenProblems(ctx)
		if err != nil {
			return nil, err
		}
		draftsMine, err := s.st.CountDraftOrdersOwnedBy(ctx, actor.UserID)
		if err != nil {
			return nil, err
		}
		owned, err := s.st.OrderIDsOwnedBy(ctx, actor.UserID)
		if err != nil {
			return nil, err
		}
		ownedSet := map[bson.ObjectID]bool{}
		for _, id := range owned {
			ownedSet[id] = true
		}
		closeMine := 0
		for _, l := range toClose {
			if ownedSet[l.VendorOrderID] {
				closeMine++
			}
		}
		ownedLines, err := s.st.LinesByOrders(ctx, owned)
		if err != nil {
			return nil, err
		}
		lineIDs := make([]bson.ObjectID, len(ownedLines))
		for i, l := range ownedLines {
			lineIDs[i] = l.ID
		}
		openMine, err := s.st.CountOpenProblemsOnLines(ctx, lineIDs)
		if err != nil {
			return nil, err
		}
		out.DraftVendorOrders = &OwnedCountTask{Count: drafts, Mine: draftsMine}
		out.OpenProblems = &OwnedCountTask{Count: open, Mine: openMine}
		out.LinesToClose = &OwnedCountTask{Count: len(toClose), Mine: closeMine}
	}
	if actor.IsPurchaser || actor.IsReceiver {
		n, err := s.st.CountPendingDeliveryLines(ctx)
		if err != nil {
			return nil, err
		}
		out.DeliveriesToMatch = &CountTask{Count: n}
	}
	return out, nil
}

// itemsToPurchase groups approved items with remaining quantity by vendor.
func (s *Tasks) itemsToPurchase(ctx context.Context, actor authz.Actor) ([]VendorTask, error) {
	items, err := s.st.ItemsToPurchase(ctx)
	if err != nil {
		return nil, err
	}
	vendors, err := s.st.ListVendors(ctx, true)
	if err != nil {
		return nil, err
	}
	mine := map[bson.ObjectID]bool{}
	groups := GroupByVendor(items, vendors, func(it domain.Item) *bson.ObjectID { return it.VendorID }, func(it domain.Item) string { return it.VendorName })
	out := make([]VendorTask, 0, len(groups))
	for _, g := range groups {
		vt := VendorTask{VendorID: g.VendorID, Inactive: g.Inactive, Count: len(g.Items)}
		if g.VendorID != nil {
			n := g.Name
			vt.Vendor = &n
		}
		for _, it := range g.Items {
			if _, ok := mine[it.BatchID]; !ok {
				b, err := s.st.GetBatch(ctx, it.BatchID)
				mine[it.BatchID] = err == nil && authzIsPurchaserOf(actor.UserID, b)
			}
			if mine[it.BatchID] {
				vt.MyBatches++
			}
		}
		out = append(out, vt)
	}
	return out, nil
}

func authzIsPurchaserOf(user bson.ObjectID, b *domain.Batch) bool {
	for _, p := range b.Assignments.Purchasers {
		if p == user {
			return true
		}
	}
	return false
}
