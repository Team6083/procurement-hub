package service

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

func TestVendorOrderOwnersAndProblemRecipients(t *testing.T) {
	e := newFlowEnv(t)
	ctx := context.Background()
	log := audit.New(e.st.DB)
	orders := NewVendorOrders(e.st, log, e.batches, []string{"USD"})
	dels := NewDeliveries(e.st, log, e.batches, orders)

	mk := func(sub string, purchaser bool) authz.Actor {
		u, err := e.st.UpsertUser(ctx, sub, sub, sub+"@example.org", sub)
		if err != nil {
			t.Fatal(err)
		}
		if err := e.st.MarkSynced(ctx, u.ID, u.UpdatedAt, sub, sub+"@example.org", sub, domain.RoleSnapshot{Purchaser: purchaser}); err != nil {
			t.Fatal(err)
		}
		return authz.Actor{UserID: u.ID, IsPurchaser: purchaser}
	}
	buyer, other, plain := mk("buyer", true), mk("other", true), mk("plain", false)

	v := &domain.Vendor{Name: "Acme", DefaultCurrency: "USD", Active: true}
	if err := e.st.InsertVendor(ctx, v); err != nil {
		t.Fatal(err)
	}
	// Default owner is the creator; non-purchasers are refused.
	d, err := orders.Create(ctx, buyer, CreateOrderInput{VendorID: v.ID})
	if err != nil || len(d.OwnerIDs) != 1 || d.OwnerIDs[0] != buyer.UserID {
		t.Fatalf("default owners: %v %v", err, d)
	}
	if _, err := orders.Create(ctx, buyer, CreateOrderInput{VendorID: v.ID, OwnerIDs: []bson.ObjectID{plain.UserID}}); err == nil {
		t.Fatal("non-purchaser owner must be refused")
	}

	owners := func() []OwnerRef {
		got, err := orders.Get(ctx, buyer, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got.Owners
	}
	if o := owners(); len(o) != 1 || o[0].ID != buyer.UserID || o[0].DisplayName != "buyer" || !o[0].IsPurchaser {
		t.Fatalf("owners view: %+v", o)
	}

	l := &domain.VendorOrderLine{VendorOrderID: d.ID, TeamID: e.team.ID}
	rec := func() []bson.ObjectID {
		rs, err := dels.problemRecipients(ctx, l)
		if err != nil {
			t.Fatal(err)
		}
		return rs
	}
	// Owners come first.
	if rs := rec(); len(rs) != 1 || rs[0] != buyer.UserID {
		t.Fatalf("owners: %v", rs)
	}
	// isPurchaser follows roleSnapshot: false after the role is lost; the name stays.
	if err := e.st.MarkSynced(ctx, buyer.UserID, d.UpdatedAt, "buyer", "buyer@example.org", "buyer", domain.RoleSnapshot{}); err != nil {
		t.Fatal(err)
	}
	if o := owners(); len(o) != 1 || o[0].IsPurchaser || o[0].DisplayName != "buyer" {
		t.Fatalf("owners view after role loss: %+v", o)
	}
	if err := e.st.MarkSynced(ctx, buyer.UserID, d.UpdatedAt, "buyer", "buyer@example.org", "buyer", domain.RoleSnapshot{Purchaser: true}); err != nil {
		t.Fatal(err)
	}
	// An owner who lost the role does not count; no batch purchasers: everyone.
	if err := e.st.MarkSynced(ctx, buyer.UserID, d.UpdatedAt, "buyer", "buyer@example.org", "buyer", domain.RoleSnapshot{}); err != nil {
		t.Fatal(err)
	}
	if rs := rec(); len(rs) != 0 {
		t.Fatalf("want fallback to all purchasers, got %v", rs)
	}
	// Batch purchasers are the second group.
	b := e.openBatch(t)
	b, err = e.batches.SetAssignments(ctx, e.admin, b.ID, b.Version, AssignmentsInput{
		Approvers: b.Assignments.Approvers, Purchasers: []bson.ObjectID{other.UserID},
	})
	if err != nil {
		t.Fatal(err)
	}
	l.BatchID = &b.ID
	if rs := rec(); len(rs) != 1 || rs[0] != other.UserID {
		t.Fatalf("batch purchasers: %v", rs)
	}
	// Changing owners through Replace emits assignment.added for the new one.
	cur, err := orders.Get(ctx, other, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := orders.Replace(ctx, other, d.ID, cur.Version, OrderFields{VendorID: v.ID, Currency: "USD", OwnerIDs: []bson.ObjectID{other.UserID}}); err != nil {
		t.Fatal(err)
	}
	n, err := e.st.DB.Collection("eventOutbox").CountDocuments(ctx, bson.D{{Key: "type", Value: "assignment.added"}, {Key: "recipient", Value: other.UserID.Hex()}, {Key: "objectId", Value: d.ID.Hex()}})
	if err != nil || n != 1 {
		t.Fatalf("assignment.added count = %d, %v", n, err)
	}
}
