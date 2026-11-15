package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
)

type recvEnv struct {
	*orderEnv
	recv  *Receiving
	tasks *Tasks
}

func newRecvEnv(t *testing.T) *recvEnv {
	t.Helper()
	e := newOrderEnv(t)
	log := audit.New(e.st.DB)
	bt := NewBatches(e.st, log, []string{"USD", "EUR"}, domain.Currencies{Base: "USD", BaseDecimals: -1})
	return &recvEnv{orderEnv: e, recv: NewReceiving(e.st, log, bt, e.txs), tasks: NewTasks(e.st)}
}

// receivingBatch returns a batch in `receiving` whose items cost 10 USD each
// (plus 6 USD of shipping, split evenly) and have the given quantities. All
// items are in one placed order.
func (e *recvEnv) receivingBatch(t *testing.T, quantities ...int) (*domain.Batch, []*domain.Item, *domain.Order) {
	t.Helper()
	ctx := context.Background()
	b, items := e.orderingBatch(t, len(quantities))
	var ids []bson.ObjectID
	var prices []ItemPriceInput
	for i, it := range items {
		if err := e.st.ApplyItemFields(ctx, it.ID, bson.D{{Key: "quantity", Value: quantities[i]}}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, it.ID)
		prices = append(prices, ItemPriceInput{ItemID: it.ID, Price: money(t, "10", "USD")})
	}
	o := e.order(t, b, ids...)
	tx, err := e.txs.Create(ctx, e.admin, CreateVendorTransactionInput{OrderIDs: []bson.ObjectID{o.ID}, Currency: "USD"})
	if err != nil {
		t.Fatal(err)
	}
	tx, err = e.txs.Update(ctx, e.admin, tx.ID, tx.Version, VendorTxPatch{
		ItemPrices:  prices,
		SharedCosts: &[]domain.SharedCost{{Type: domain.SharedShipping, Amount: *decimalPtr(t, "6")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.txs.Place(ctx, e.admin, tx.ID, tx.Version); err != nil {
		t.Fatal(err)
	}
	b, _ = e.st.GetBatch(ctx, b.ID)
	if b.Status != domain.BatchReceiving {
		t.Fatalf("batch = %s, want receiving", b.Status)
	}
	o, _ = e.st.GetOrder(ctx, o.ID)
	for i := range items {
		items[i], _ = e.st.GetItem(ctx, items[i].ID)
	}
	return b, items, o
}

func (e *recvEnv) receive(t *testing.T, who authz.Actor, it *domain.Item, qty int) *ReceiptResult {
	t.Helper()
	cur, _ := e.st.GetItem(context.Background(), it.ID)
	res, err := e.recv.RecordReceipt(context.Background(), who, it.ID, cur.Version, ReceiptInput{Quantity: qty})
	if err != nil {
		t.Fatalf("receive %d of item #%d: %v", qty, it.SeqNo, err)
	}
	return res
}

func (e *recvEnv) report(t *testing.T, it *domain.Item, typ domain.ExceptionType) *ExceptionResult {
	t.Helper()
	cur, _ := e.st.GetItem(context.Background(), it.ID)
	res, err := e.recv.ReportException(context.Background(), e.member, it.ID, cur.Version, ExceptionInput{Type: typ, Description: "box crushed"})
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	return res
}

func ruleCode(err error) string {
	var re *RuleError
	if errors.As(err, &re) {
		return re.Code
	}
	return ""
}

func (e *recvEnv) batchStatus(t *testing.T, id bson.ObjectID) domain.BatchStatus {
	t.Helper()
	b, err := e.st.GetBatch(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return b.Status
}

// Acceptance criterion 6: partial receipt, damage exception, refund; the
// batch completes only once every item is closed, and the refund is in the
// order's totals.
func TestReceivingFlowAndAutomaticCompletion(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	b, items, o := e.receivingBatch(t, 3, 1)
	if o.TotalBase.String() != "46" { // 3*10 + 1*10 + 6 shipping
		t.Fatalf("order total = %s, want 46", o.TotalBase)
	}
	a, c := items[0], items[1]

	// A short receipt, then too much.
	r := e.receive(t, e.member, a, 1)
	if r.Item.Status != domain.ItemPartiallyReceived || r.Item.ReceivedQuantity != 1 || r.Receipt.Quantity != 1 || r.Batch.Status != domain.BatchReceiving {
		t.Fatalf("after first receipt: %+v / %+v", r.Item, r.Batch)
	}
	if _, err := e.recv.RecordReceipt(ctx, e.member, a.ID, r.Item.Version, ReceiptInput{Quantity: 3}); ruleCode(err) != "receipt_exceeds_quantity" {
		t.Fatalf("over-receipt err = %v", err)
	}
	if _, err := e.recv.RecordReceipt(ctx, e.member, a.ID, r.Item.Version, ReceiptInput{Quantity: 0}); err == nil {
		t.Fatal("zero quantity accepted")
	}

	// Damage: the item is in exception, cannot be received, the batch stays.
	x := e.report(t, a, domain.ExcDamaged)
	if x.Item.Status != domain.ItemException || x.Exception.Resolved() {
		t.Fatalf("exception = %+v item = %s", x.Exception, x.Item.Status)
	}
	if _, err := e.recv.RecordReceipt(ctx, e.member, a.ID, x.Item.Version, ReceiptInput{Quantity: 1}); ruleCode(err) != "invalid_transition" {
		t.Fatalf("receipt on exception: %v", err)
	}
	if _, err := e.recv.ReportException(ctx, e.member, a.ID, x.Item.Version, ExceptionInput{Type: domain.ExcDamaged, Description: "again"}); ruleCode(err) != "invalid_transition" {
		t.Fatalf("second exception: %v", err)
	}
	// The other item is received completely; the open exception keeps the batch open.
	if r := e.receive(t, e.member, c, 1); r.Item.Status != domain.ItemReceived || r.Batch.Status != domain.BatchReceiving {
		t.Fatalf("complete receipt: item %s batch %s", r.Item.Status, r.Batch.Status)
	}

	// Refund 4.00 and accept what arrived: closes the item, completes the batch.
	refund := decimal.RequireFromString("4")
	res, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionAccept, Note: "keep the rest", Refund: &refund})
	if err != nil {
		t.Fatal(err)
	}
	if res.Item.Status != domain.ItemAcceptedShort || res.Item.CloseReason != "keep the rest" || res.Item.ReceivedQuantity != 1 {
		t.Fatalf("item = %+v", res.Item)
	}
	if res.Batch.Status != domain.BatchCompleted || e.batchStatus(t, b.ID) != domain.BatchCompleted {
		t.Fatalf("batch = %s, want completed", res.Batch.Status)
	}
	if res.Adjustment == nil || res.Adjustment.AmountBase.String() != "-4" || res.Adjustment.ItemID == nil || *res.Adjustment.ItemID != a.ID {
		t.Fatalf("adjustment = %+v", res.Adjustment)
	}
	if res.Exception.Resolution == nil || res.Exception.Resolution.RefundAmountBase.String() != "4" || res.Exception.Version != 2 {
		t.Fatalf("resolution = %+v", res.Exception.Resolution)
	}
	got, _ := e.st.GetOrder(ctx, o.ID)
	if got.AdjustmentsBase.String() != "-4" || got.TotalBase.String() != "42" || got.ItemsCostBase.String() != "40" {
		t.Fatalf("order = items %s adj %s total %s", got.ItemsCostBase, got.AdjustmentsBase, got.TotalBase)
	}
	// The batch is closed now: nothing more to resolve.
	if _, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, 2, ResolveInput{Action: domain.ActionCancel, Note: "x"}); ruleCode(err) != "batch_not_receiving" {
		t.Fatalf("resolve after completion: %v", err)
	}

	// Audit: the item's timeline tells the story; the batch's has the auto completion.
	pg, err := audit.New(e.st.DB).PageForObject(ctx, "item", a.ID.Hex(), bson.ObjectID{}, 50)
	if err != nil {
		t.Fatal(err)
	}
	var actions []string
	for _, ev := range pg.Events {
		actions = append(actions, ev.Action)
	}
	want := []string{"item.created", "item.approved", "item.ordered", "item.received", "item.exception_reported", "item.exception_resolved"}
	if len(actions) < len(want) || actions[len(actions)-3] != "item.received" || actions[len(actions)-1] != "item.exception_resolved" {
		t.Errorf("item audit = %v, want to end with %v", actions, want[3:])
	}
	bp, _ := audit.New(e.st.DB).PageForBatch(ctx, b.ID, bson.ObjectID{}, 200)
	var sawAdj, sawDone bool
	for _, ev := range bp.Events {
		sawAdj = sawAdj || ev.Action == "order.adjusted"
		sawDone = sawDone || (ev.Action == "batch.auto_transition" && ev.Changes[0].To == "completed")
	}
	if !sawAdj || !sawDone {
		t.Errorf("batch audit lacks order.adjusted (%v) or completion (%v)", sawAdj, sawDone)
	}
}

func TestExchangeReturnsItemToWaiting(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	_, items, _ := e.receivingBatch(t, 4, 2)

	// Nothing received yet: exchange goes back to ordered.
	x := e.report(t, items[0], domain.ExcWrongItem)
	res, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange})
	if err != nil || res.Item.Status != domain.ItemOrdered || res.Adjustment != nil {
		t.Fatalf("exchange: %v %+v", err, res)
	}
	// Something received: back to partially_received, then it can be completed.
	e.receive(t, e.member, items[1], 1)
	x = e.report(t, items[1], domain.ExcQuantityMismatch)
	res, err = e.recv.Resolve(ctx, e.admin, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange, Note: "vendor re-ships"})
	if err != nil || res.Item.Status != domain.ItemPartiallyReceived || res.Item.ReceivedQuantity != 1 {
		t.Fatalf("exchange: %v %+v", err, res.Item)
	}
	// Resolving twice is refused.
	if _, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, res.Exception.Version, ResolveInput{Action: domain.ActionExchange}); ruleCode(err) != "exception_resolved" {
		t.Fatalf("second resolve: %v", err)
	}
	refund := decimal.RequireFromString("1")
	x = e.report(t, items[1], domain.ExcDamaged)
	if _, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange, Refund: &refund}); err == nil {
		t.Fatal("refund with exchange accepted")
	}
	// Both exceptions of the item stay listed, oldest first.
	list, _ := e.recv.ListExceptions(ctx, e.member, items[1].ID)
	if len(list) != 2 || !list[0].Resolved() || list[1].Resolved() || list[0].Type != domain.ExcQuantityMismatch {
		t.Fatalf("exceptions = %+v", list)
	}
}

func TestCancelAndRefundRules(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	b, items, o := e.receivingBatch(t, 2, 2)
	x := e.report(t, items[0], domain.ExcWrongItem)
	res := func(in ResolveInput, version int64) error {
		_, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, version, in)
		return err
	}
	dec := func(s string) *decimal.Decimal { d := decimal.RequireFromString(s); return &d }
	var ve *ValidationError
	for name, in := range map[string]ResolveInput{
		"unknown action":      {Action: "refund", Note: "x"},
		"cancel without note": {Action: domain.ActionCancel, Note: "  "},
		"zero refund":         {Action: domain.ActionCancel, Note: "x", Refund: dec("0")},
		"negative refund":     {Action: domain.ActionCancel, Note: "x", Refund: dec("-3")},
		"too many decimals":   {Action: domain.ActionCancel, Note: "x", Refund: dec("1.001")},
		"note too long":       {Action: domain.ActionCancel, Note: string(make([]rune, 1001))},
	} {
		if err := res(in, x.Exception.Version); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want validation error", name, err)
		}
	}
	if err := res(ResolveInput{Action: domain.ActionAccept, Note: "x"}, x.Exception.Version); ruleCode(err) != "nothing_received" {
		t.Errorf("accept with nothing received: %v", err)
	}
	if err := res(ResolveInput{Action: domain.ActionCancel, Note: "x"}, x.Exception.Version+5); !errors.Is(err, ErrVersionConflict) {
		t.Errorf("stale version: %v", err)
	}
	// A failure while booking the refund rolls the whole disposition back.
	if err := e.st.ApplyOrderFields(ctx, o.ID, bson.D{{Key: "status", Value: domain.OrderCancelled}}); err != nil {
		t.Fatal(err)
	}
	if err := res(ResolveInput{Action: domain.ActionCancel, Note: "lost", Refund: dec("5")}, x.Exception.Version); ruleCode(err) != "order_not_placed" {
		t.Fatalf("refund on cancelled order: %v", err)
	}
	if e0, _ := e.st.GetException(ctx, x.Exception.ID); e0.Resolved() || e0.Version != x.Exception.Version {
		t.Errorf("exception changed by a failed resolve: %+v", e0)
	}
	if it, _ := e.st.GetItem(ctx, items[0].ID); it.Status != domain.ItemException {
		t.Errorf("item = %s after failed resolve", it.Status)
	}
	if n, _ := e.st.AdjustmentTotals(ctx, []bson.ObjectID{o.ID}); len(n) != 0 {
		t.Errorf("adjustment left behind: %v", n)
	}
	if err := e.st.ApplyOrderFields(ctx, o.ID, bson.D{{Key: "status", Value: domain.OrderPlaced}}); err != nil {
		t.Fatal(err)
	}
	// Cancelling gives up on the item; the last open item closes, completing the batch.
	e.receive(t, e.member, items[1], 2)
	if e.batchStatus(t, b.ID) != domain.BatchReceiving {
		t.Fatal("batch finished while an exception is open")
	}
	if err := res(ResolveInput{Action: domain.ActionCancel, Note: "vendor lost it", Refund: dec("10")}, x.Exception.Version); err != nil {
		t.Fatal(err)
	}
	if it, _ := e.st.GetItem(ctx, items[0].ID); it.Status != domain.ItemNotObtained || it.CloseReason != "vendor lost it" {
		t.Errorf("item = %+v", it)
	}
	if e.batchStatus(t, b.ID) != domain.BatchCompleted {
		t.Error("batch should complete")
	}
	if got, _ := e.st.GetOrder(ctx, o.ID); got.TotalBase.String() != "36" { // 20 + 20 + 6 shipping - 10 refund
		t.Errorf("order total = %s, want 36", got.TotalBase)
	}
}

func TestReceivingAuthorizationAndState(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	b, items, o := e.receivingBatch(t, 2, 2)
	it := items[0]
	root := e.admin
	root.UserID, root.TeamRoles, root.IsSystemAdmin = bson.NewObjectID(), nil, true

	in := ReceiptInput{Quantity: 1}
	for name, who := range map[string]authz.Actor{"approver": e.approver, "system admin": root} {
		if _, err := e.recv.RecordReceipt(ctx, who, it.ID, it.Version, in); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s receipt: %v", name, err)
		}
		if _, err := e.recv.ReportException(ctx, who, it.ID, it.Version, ExceptionInput{Type: domain.ExcDamaged, Description: "x"}); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s exception: %v", name, err)
		}
	}
	// Team admin (also the purchaser) may receive; the assigned receiver may.
	if _, err := e.recv.RecordReceipt(ctx, e.admin, it.ID, it.Version, in); err != nil {
		t.Fatal(err)
	}
	x := e.report(t, items[1], domain.ExcDamaged)
	// Receivers cannot resolve or book adjustments.
	if _, err := e.recv.Resolve(ctx, e.member, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange}); !errors.Is(err, ErrForbidden) {
		t.Errorf("receiver resolve: %v", err)
	}
	if _, err := e.recv.Resolve(ctx, root, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange}); !errors.Is(err, ErrForbidden) {
		t.Errorf("system admin resolve: %v", err)
	}
	if _, err := e.recv.AddAdjustment(ctx, e.member, o.ID, o.Version, AdjustmentInput{AmountBase: decimal.RequireFromString("-1"), Reason: "x"}); !errors.Is(err, ErrForbidden) {
		t.Errorf("receiver adjustment: %v", err)
	}
	// Unknown ids are 404.
	if _, err := e.recv.Resolve(ctx, e.admin, bson.NewObjectID(), 1, ResolveInput{Action: domain.ActionExchange}); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown exception: %v", err)
	}
	if _, err := e.recv.RecordReceipt(ctx, e.admin, bson.NewObjectID(), 1, in); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown item: %v", err)
	}
	// Outside `receiving` nothing can be recorded.
	if _, err := e.st.UpdateBatch(ctx, b.ID, b.Version, bson.D{{Key: "status", Value: domain.BatchCompleted}}); err != nil {
		t.Fatal(err)
	}
	cur, _ := e.st.GetItem(ctx, it.ID)
	if _, err := e.recv.RecordReceipt(ctx, e.member, it.ID, cur.Version, in); ruleCode(err) != "batch_not_receiving" {
		t.Errorf("receipt after completion: %v", err)
	}
	if _, err := e.recv.Resolve(ctx, e.admin, x.Exception.ID, x.Exception.Version, ResolveInput{Action: domain.ActionExchange}); ruleCode(err) != "batch_not_receiving" {
		t.Errorf("resolve after completion: %v", err)
	}
	// Adjustments remain possible after completion.
	if _, err := e.recv.AddAdjustment(ctx, e.admin, o.ID, o.Version, AdjustmentInput{AmountBase: decimal.RequireFromString("2"), Reason: "late fee"}); err != nil {
		t.Errorf("adjustment after completion: %v", err)
	}
}

// Two receivers submitting with the same item version: one wins, the other
// must refetch (so nothing is counted twice).
func TestConcurrentReceipts(t *testing.T) {
	e := newRecvEnv(t)
	_, items, _ := e.receivingBatch(t, 10)
	it := items[0]
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = e.recv.RecordReceipt(context.Background(), e.member, it.ID, it.Version, ReceiptInput{Quantity: 3})
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
	got, _ := e.st.GetItem(context.Background(), it.ID)
	rs, _ := e.recv.ListReceipts(context.Background(), e.member, it.ID)
	if ok != 1 || got.ReceivedQuantity != 3 || len(rs) != 1 {
		t.Fatalf("%d receipts succeeded, received %d, %d records; want 1, 3, 1", ok, got.ReceivedQuantity, len(rs))
	}
}

func TestAdjustments(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	_, items, o := e.receivingBatch(t, 1, 1)
	d := decimal.RequireFromString
	var ve *ValidationError

	for name, in := range map[string]AdjustmentInput{
		"zero":            {AmountBase: d("0"), Reason: "x"},
		"no reason":       {AmountBase: d("1"), Reason: " "},
		"too many digits": {AmountBase: d("1.001"), Reason: "x"},
		"foreign item":    {AmountBase: d("1"), Reason: "x", ItemID: ptr(bson.NewObjectID())},
	} {
		if _, err := e.recv.AddAdjustment(ctx, e.admin, o.ID, o.Version, in); !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want validation error", name, err)
		}
	}
	if _, err := e.recv.AddAdjustment(ctx, e.admin, o.ID, o.Version+1, AdjustmentInput{AmountBase: d("1"), Reason: "x"}); !errors.Is(err, ErrVersionConflict) {
		t.Errorf("stale version: %v", err)
	}

	res, err := e.recv.AddAdjustment(ctx, e.admin, o.ID, o.Version, AdjustmentInput{AmountBase: d("-2.5"), Reason: "price match", ItemID: ptr(items[0].ID)})
	if err != nil {
		t.Fatal(err)
	}
	if res.Adjustment.AmountBase.String() != "-2.5" || res.Adjustment.CreatedBy != e.admin.UserID || res.Order.AdjustmentsBase.String() != "-2.5" ||
		res.Order.TotalBase.String() != "23.5" || res.Order.Version <= o.Version {
		t.Fatalf("result = %+v / %+v", res.Adjustment, res.Order)
	}
	// Adjustments add up, positive ones included (a late surcharge).
	res, err = e.recv.AddAdjustment(ctx, e.admin, o.ID, res.Order.Version, AdjustmentInput{AmountBase: d("1"), Reason: "surcharge"})
	if err != nil || res.Order.AdjustmentsBase.String() != "-1.5" || res.Order.TotalBase.String() != "24.5" {
		t.Fatalf("second adjustment: %v %+v", err, res.Order)
	}
	// The items' own cost figures are untouched; only the order total moves.
	if it, _ := e.st.GetItem(ctx, items[0].ID); it.ActualCostBase == nil || it.ActualCostBase.String() != "10" {
		t.Errorf("item actual cost = %v", it.ActualCostBase)
	}
	// Orders that are not placed take no adjustments.
	if err := e.st.ApplyOrderFields(ctx, o.ID, bson.D{{Key: "status", Value: domain.OrderCancelled}}); err != nil {
		t.Fatal(err)
	}
	cur, _ := e.st.GetOrder(ctx, o.ID)
	if _, err := e.recv.AddAdjustment(ctx, e.admin, o.ID, cur.Version, AdjustmentInput{AmountBase: d("1"), Reason: "x"}); ruleCode(err) != "order_not_placed" {
		t.Errorf("cancelled order: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestReceivingTasks(t *testing.T) {
	e := newRecvEnv(t)
	ctx := context.Background()
	b, items, _ := e.receivingBatch(t, 2, 2)
	counts := func(who authz.Actor) (recv, exc int) {
		tk, err := e.tasks.For(ctx, who)
		if err != nil {
			t.Fatal(err)
		}
		for _, x := range tk.ItemsToReceive {
			if x.Batch.ID == b.ID {
				recv = x.Count
			}
		}
		for _, x := range tk.OpenExceptions {
			if x.Batch.ID == b.ID {
				exc = x.Count
			}
		}
		return
	}
	if r, x := counts(e.member); r != 2 || x != 0 {
		t.Fatalf("receiver tasks = %d, %d", r, x)
	}
	if r, x := counts(e.approver); r != 0 || x != 0 {
		t.Fatalf("approver tasks = %d, %d", r, x)
	}
	e.receive(t, e.member, items[0], 2)
	e.report(t, items[1], domain.ExcDamaged)
	if r, x := counts(e.member); r != 0 || x != 0 {
		t.Fatalf("receiver tasks after = %d, %d (exceptions belong to purchasers)", r, x)
	}
	// The team admin is an implicit receiver and purchaser.
	if r, x := counts(e.admin); r != 0 || x != 1 {
		t.Fatalf("admin tasks = %d, %d", r, x)
	}
}
