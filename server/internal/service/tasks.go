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

// MyTasks is the "my tasks" payload (spec §16.2). Receiving and exception
// tasks arrive with milestone 5 and are empty until then.
type MyTasks struct {
	ProposalsToHandle []BatchTask
	ItemsToReview     []BatchTask
	ReturnedItems     []domain.Item
	BatchesToOrder    []BatchTask
	ItemsToReceive    []BatchTask
	OpenExceptions    []BatchTask
}

func (s *Tasks) For(ctx context.Context, actor authz.Actor) (*MyTasks, error) {
	out := &MyTasks{
		ProposalsToHandle: []BatchTask{}, ItemsToReview: []BatchTask{}, ReturnedItems: []domain.Item{},
		BatchesToOrder: []BatchTask{}, ItemsToReceive: []BatchTask{}, OpenExceptions: []BatchTask{},
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
		}
	}

	if len(teamIDs) > 0 {
		bs, err := s.st.BatchesByStatus(ctx, domain.BatchOrdering, teamIDs)
		if err != nil {
			return nil, err
		}
		for _, b := range bs {
			if !actor.HasBatchRole(b.TeamID, authzAssignments(b.Assignments), authz.BatchPurchaser) {
				continue
			}
			counts, err := s.st.ItemCounts(ctx, b.ID)
			if err != nil {
				return nil, err
			}
			// Approved items still wait for an order or an unpurchasable mark.
			if n := counts[domain.ItemApproved]; n > 0 {
				out.BatchesToOrder = append(out.BatchesToOrder, BatchTask{Batch: b, Count: n})
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
	return out, nil
}
