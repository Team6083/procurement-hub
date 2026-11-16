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

// VendorTask counts items to purchase for one vendor (nil Vendor: no vendor).
type VendorTask struct {
	Vendor *string `json:"vendor"`
	Count  int     `json:"count"`
	// MyBatches counts those in batches the caller is assigned to as purchaser.
	MyBatches int `json:"myBatches"`
}

// CountTask is a plain counter.
type CountTask struct {
	Count int `json:"count"`
}

// MyTasks is the "my tasks" payload (spec §16.2). Role-specific parts are nil
// for callers without the role.
type MyTasks struct {
	ProposalsToHandle []BatchTask
	ItemsToReview     []BatchTask
	ReturnedItems     []domain.Item
	ReviewsToConfirm  []BatchTask
	ItemsToPurchase   []VendorTask // purchasers
	DraftVendorOrders *CountTask   // purchasers
	OpenProblems      *CountTask   // purchasers
	LinesToClose      *CountTask   // purchasers
	DeliveriesToMatch *CountTask   // purchasers and receivers
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
		out.DraftVendorOrders, out.OpenProblems, out.LinesToClose = &CountTask{}, &CountTask{}, &CountTask{}
	}
	if actor.IsPurchaser || actor.IsReceiver {
		out.DeliveriesToMatch = &CountTask{}
	}
	return out, nil
}

// itemsToPurchase groups approved items with remaining quantity by vendor.
func (s *Tasks) itemsToPurchase(ctx context.Context, actor authz.Actor) ([]VendorTask, error) {
	items, err := s.st.ItemsToPurchase(ctx)
	if err != nil {
		return nil, err
	}
	mine := map[bson.ObjectID]bool{}
	byVendor := map[string]*VendorTask{}
	var order []string
	for _, it := range items {
		key := it.Vendor
		vt, ok := byVendor[key]
		if !ok {
			vt = &VendorTask{}
			if key != "" {
				k := key
				vt.Vendor = &k
			}
			byVendor[key] = vt
			order = append(order, key)
		}
		vt.Count++
		if _, ok := mine[it.BatchID]; !ok {
			b, err := s.st.GetBatch(ctx, it.BatchID)
			mine[it.BatchID] = err == nil && authzIsPurchaserOf(actor.UserID, b)
		}
		if mine[it.BatchID] {
			vt.MyBatches++
		}
	}
	out := make([]VendorTask, 0, len(order))
	for _, k := range order {
		out = append(out, *byVendor[k])
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
