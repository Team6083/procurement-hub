package service

import (
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

func TestCanModify(t *testing.T) {
	team := bson.NewObjectID()
	req, other, adm := bson.NewObjectID(), bson.NewObjectID(), bson.NewObjectID()
	roles := map[bson.ObjectID]domain.Role{team: domain.RoleMember}
	requester := authz.Actor{UserID: req, TeamRoles: roles}
	stranger := authz.Actor{UserID: other, TeamRoles: roles}
	admin := authz.Actor{UserID: adm, TeamRoles: map[bson.ObjectID]domain.Role{team: domain.RoleAdmin}}
	sysadmin := authz.Actor{UserID: bson.NewObjectID(), IsSystemAdmin: true} // not a member of the team

	tests := []struct {
		name  string
		actor authz.Actor
		item  domain.ItemStatus
		batch domain.BatchStatus
		want  bool
	}{
		{"own pending in proposed", requester, domain.ItemPending, domain.BatchProposed, true},
		{"own pending in collecting", requester, domain.ItemPending, domain.BatchCollecting, true},
		{"own pending in reviewing", requester, domain.ItemPending, domain.BatchReviewing, false},
		{"own returned in reviewing", requester, domain.ItemReturned, domain.BatchReviewing, true},
		{"own returned in collecting", requester, domain.ItemReturned, domain.BatchCollecting, false},
		{"own approved in collecting", requester, domain.ItemApproved, domain.BatchCollecting, false},
		{"someone else's pending", stranger, domain.ItemPending, domain.BatchCollecting, false},
		{"admin edits any in collecting", admin, domain.ItemPending, domain.BatchCollecting, true},
		{"admin cannot edit in reviewing", admin, domain.ItemPending, domain.BatchReviewing, false},
		{"admin cannot edit approved", admin, domain.ItemApproved, domain.BatchCollecting, false},
		{"system admin edits any pending item in collecting", sysadmin, domain.ItemPending, domain.BatchCollecting, true},
		{"system admin edits any returned item in collecting", sysadmin, domain.ItemReturned, domain.BatchCollecting, true},
		{"system admin cannot edit in reviewing", sysadmin, domain.ItemPending, domain.BatchReviewing, false},
		{"system admin cannot edit approved", sysadmin, domain.ItemApproved, domain.BatchCollecting, false},
	}
	for _, tt := range tests {
		it := &domain.Item{RequesterID: req, Status: tt.item}
		b := &domain.Batch{TeamID: team, Status: tt.batch}
		if got := canModify(tt.actor, it, b); got != tt.want {
			t.Errorf("%s: got %v want %v", tt.name, got, tt.want)
		}
	}
}

func TestDiffItemOnlyReportsChanges(t *testing.T) {
	p, _ := domain.NewDecimal("10.00")
	it := &domain.Item{Name: "A", Quantity: 1, Priority: 3, Purpose: "x", EstimatedUnitPrice: domain.Money{Amount: p, Currency: "USD"}}
	same := ItemInput{Name: "A", Quantity: 1, Priority: 3, Purpose: "x", EstimatedUnitPrice: domain.Money{Amount: p, Currency: "USD"}}
	if got := diffItem(it, same); len(got) != 0 {
		t.Fatalf("no-op edit produced changes: %v", got)
	}
	p2, _ := domain.NewDecimal("10") // numerically equal, different scale
	same.EstimatedUnitPrice.Amount = p2
	if got := diffItem(it, same); len(got) != 0 {
		t.Fatalf("equal price at different scale reported as change: %v", got)
	}
	same.Quantity = 5
	if got := diffItem(it, same); len(got) != 1 || got[0].Field != "quantity" {
		t.Fatalf("expected one quantity change, got %v", got)
	}
}
