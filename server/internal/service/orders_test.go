package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

type orderEnv struct {
	*flowEnv
	orders *Orders
	txs    *VendorTransactions
}

func newOrderEnv(t *testing.T) *orderEnv {
	t.Helper()
	e := newFlowEnv(t)
	bt := NewBatches(e.st, audit.New(e.st.DB), []string{"USD", "EUR"}, domain.Currencies{Base: "USD", BaseDecimals: -1})
	log := audit.New(e.st.DB)
	return &orderEnv{flowEnv: e, orders: NewOrders(e.st, log, bt), txs: NewVendorTransactions(e.st, log, bt)}
}

// orderingBatch returns a batch in `ordering` with n approved items. The
// purchaser is the team admin.
func (e *orderEnv) orderingBatch(t *testing.T, n int) (*domain.Batch, []*domain.Item) {
	t.Helper()
	ctx := context.Background()
	b := e.openBatch(t)
	var items []*domain.Item
	var ds []Decision
	for i := 0; i < n; i++ {
		it := e.item(t, e.member, b.ID, "item"+itoa(i))
		items = append(items, it)
		ds = append(ds, Decision{ItemID: it.ID, Decision: "approve"})
	}
	b, err := e.batches.Transition(ctx, e.admin, b.ID, b.Version, TransitionInput{Action: domain.ActClose})
	if err != nil {
		t.Fatal(err)
	}
	res, err := e.items.Review(ctx, e.approver, b.ID, ds)
	if err != nil || res.Batch.Status != domain.BatchOrdering {
		t.Fatalf("review: %v %+v", err, res)
	}
	return res.Batch, items
}

func (e *orderEnv) order(t *testing.T, b *domain.Batch, ids ...bson.ObjectID) *domain.Order {
	t.Helper()
	o, err := e.orders.Create(context.Background(), e.admin, b.ID, CreateOrderInput{Vendor: "Acme", ItemIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func money(t *testing.T, amount, cur string) *domain.Money {
	t.Helper()
	d, err := domain.NewDecimal(amount)
	if err != nil {
		t.Fatal(err)
	}
	return &domain.Money{Amount: d, Currency: cur}
}

func decimalPtr(t *testing.T, s string) *domain.Decimal {
	t.Helper()
	d, err := domain.NewDecimal(s)
	if err != nil {
		t.Fatal(err)
	}
	return &d
}

// A failure half-way through placing must leave no trace: the orders placed
// before the failure roll back with everything else.
func TestPlaceRollsBackAtomically(t *testing.T) {
	e := newOrderEnv(t)
	ctx := context.Background()
	b, items := e.orderingBatch(t, 2)
	o1, o2 := e.order(t, b, items[0].ID), e.order(t, b, items[1].ID)
	tx, err := e.txs.Create(ctx, e.admin, CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o1.ID, o2.ID}, Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt the second order's item behind the service's back.
	if err := e.st.ApplyItemFields(ctx, items[1].ID, bson.D{{Key: "status", Value: domain.ItemWithdrawn}}); err != nil {
		t.Fatal(err)
	}
	var re *RuleError
	if _, err := e.txs.Place(ctx, e.admin, tx.ID, tx.Version); !errors.As(err, &re) || re.Code != "invalid_transition" {
		t.Fatalf("place err = %v, want invalid_transition", err)
	}
	got, _ := e.st.GetVendorTransaction(ctx, tx.ID)
	if got.Status != domain.OrderDraft || got.Version != tx.Version {
		t.Errorf("transaction = %s v%d", got.Status, got.Version)
	}
	for _, id := range []bson.ObjectID{o1.ID, o2.ID} {
		if o, _ := e.st.GetOrder(ctx, id); o.Status != domain.OrderDraft {
			t.Errorf("order %s = %s, want draft", id.Hex(), o.Status)
		}
	}
	if it, _ := e.st.GetItem(ctx, items[0].ID); it.Status != domain.ItemApproved {
		t.Errorf("item = %s, want approved", it.Status)
	}
	if bb, _ := e.st.GetBatch(ctx, b.ID); bb.Status != domain.BatchOrdering {
		t.Errorf("batch = %s", bb.Status)
	}
}

// Placing every approved item moves the batch to receiving in the same
// transaction; adjustments recorded later flow into the order totals.
func TestPlaceAdvancesBatchAndAdjustmentsCount(t *testing.T) {
	e := newOrderEnv(t)
	ctx := context.Background()
	b, items := e.orderingBatch(t, 1)
	o := e.order(t, b, items[0].ID)
	tx, err := e.txs.Create(ctx, e.admin, CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o.ID}, Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	tx2, err := e.txs.Update(ctx, e.admin, tx.ID, tx.Version, VendorTxPatch{
		ItemPrices:  []ItemPriceInput{{ItemID: items[0].ID, Price: money(t, "7.50", "USD")}},
		SharedCosts: &[]domain.SharedCost{{Type: domain.SharedShipping, Amount: *decimalPtr(t, "2.25")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	placed, err := e.txs.Place(ctx, e.admin, tx.ID, tx2.Version)
	if err != nil {
		t.Fatal(err)
	}
	if bb, _ := e.st.GetBatch(ctx, b.ID); bb.Status != domain.BatchReceiving {
		t.Fatalf("batch = %s, want receiving", bb.Status)
	}
	// A refund of 1.00 recorded later changes the order's total on the next recalculation.
	if err := e.st.InsertAdjustment(ctx, &domain.Adjustment{
		OrderID: o.ID, TeamID: b.TeamID, AmountBase: *decimalPtr(t, "-1"), Reason: "damaged", CreatedBy: e.admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	paid := "paid"
	if _, err := e.txs.Update(ctx, e.admin, tx.ID, placed.Version, VendorTxPatch{PaymentNote: &paid}); err != nil {
		t.Fatal(err)
	}
	got, _ := e.st.GetOrder(ctx, o.ID)
	want := map[string]string{"items": "7.5", "shared": "2.25", "adj": "-1", "total": "8.75"}
	have := map[string]string{
		"items": got.ItemsCostBase.String(), "shared": got.SharedCostBase.String(),
		"adj": got.AdjustmentsBase.String(), "total": got.TotalBase.String(),
	}
	for k, w := range want {
		if have[k] != w {
			t.Errorf("%s = %s, want %s", k, have[k], w)
		}
	}
	if got.CostsProvisional {
		t.Error("base-currency costs are exact")
	}
}

// A foreign currency without a charged amount is converted with the first
// team's reference rate and flagged provisional; the charge makes it final.
func TestReferenceRateIsProvisional(t *testing.T) {
	e := newOrderEnv(t)
	ctx := context.Background()
	b, items := e.orderingBatch(t, 1)
	team, _ := e.st.GetTeam(ctx, b.TeamID)
	rate, _ := domain.NewDecimal("1.1")
	var tmp domain.Team
	if err := e.st.UpdateVersioned(ctx, "teams", team.ID, team.Version, bson.D{{Key: "referenceRates", Value: []domain.ReferenceRate{
		{Currency: "EUR", RateToBase: rate, UpdatedBy: "test"},
	}}}, &tmp); err != nil {
		t.Fatal(err)
	}
	o := e.order(t, b, items[0].ID)
	tx, err := e.txs.Create(ctx, e.admin, CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o.ID}, Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	tx, err = e.txs.Update(ctx, e.admin, tx.ID, tx.Version, VendorTxPatch{
		ItemPrices: []ItemPriceInput{{ItemID: items[0].ID, Price: money(t, "10", "EUR")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := e.st.GetOrder(ctx, o.ID)
	if got.TotalBase.String() != "11" || !got.CostsProvisional {
		t.Fatalf("order total = %s provisional=%v, want 11 provisional", got.TotalBase, got.CostsProvisional)
	}
	if _, err := e.txs.Update(ctx, e.admin, tx.ID, tx.Version, VendorTxPatch{ChargedSet: true, Charged: decimalPtr(t, "11.37")}); err != nil {
		t.Fatal(err)
	}
	got, _ = e.st.GetOrder(ctx, o.ID)
	if got.TotalBase.String() != "11.37" || got.CostsProvisional {
		t.Fatalf("order total = %s provisional=%v, want 11.37 final", got.TotalBase, got.CostsProvisional)
	}
}

// Two buyers racing for the same approved item: exactly one order gets it.
func TestConcurrentOrderCreation(t *testing.T) {
	e := newOrderEnv(t)
	b, items := e.orderingBatch(t, 1)
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = e.orders.Create(context.Background(), e.admin, b.ID, CreateOrderInput{Vendor: "V", ItemIDs: []bson.ObjectID{items[0].ID}})
		}()
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		var re *RuleError
		switch {
		case err == nil:
			ok++
		case errors.As(err, &re) && re.Code == "item_not_orderable":
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("%d orders were created for one item, want 1", ok)
	}
	live, _ := e.st.ListOrders(context.Background(), b.ID)
	if len(live) != 1 {
		t.Errorf("orders stored = %d", len(live))
	}
}

// Concurrent edits of one external order with the same version: one wins.
func TestConcurrentTransactionEdits(t *testing.T) {
	e := newOrderEnv(t)
	ctx := context.Background()
	b, items := e.orderingBatch(t, 1)
	o := e.order(t, b, items[0].ID)
	tx, err := e.txs.Create(ctx, e.admin, CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o.ID}, Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			note := "note " + itoa(i)
			_, errs[i] = e.txs.Update(ctx, e.admin, tx.ID, tx.Version, VendorTxPatch{PaymentNote: &note})
		}()
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrVersionConflict):
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("%d edits succeeded with the same version, want 1", ok)
	}
}

// A system admin is not a purchaser, and an outsider of a members-only team
// learns nothing: 404 before 403.
func TestTransactionAuthorization(t *testing.T) {
	e := newOrderEnv(t)
	ctx := context.Background()
	b, items := e.orderingBatch(t, 1)
	o := e.order(t, b, items[0].ID)
	in := CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o.ID}, Currency: "USD"}
	root := e.admin
	root.UserID, root.TeamRoles, root.IsSystemAdmin = bson.NewObjectID(), nil, true
	if _, err := e.txs.Create(ctx, root, in); !errors.Is(err, ErrForbidden) {
		t.Errorf("system admin create: %v", err)
	}
	if _, err := e.txs.Create(ctx, e.member, in); !errors.Is(err, ErrForbidden) {
		t.Errorf("member create: %v", err)
	}
	if _, err := e.txs.Create(ctx, e.admin, in); err != nil {
		t.Fatal(err)
	}
}
