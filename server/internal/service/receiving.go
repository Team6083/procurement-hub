package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Receiving implements receiving records, exceptions, their dispositions and
// order adjustments (spec §10.2, §11). Receivers and purchasers record
// receipts and report exceptions while the batch is `receiving`; only
// purchasers disposition exceptions and book adjustments. Every write also
// re-evaluates the batch's automatic transitions in the same transaction, so
// the batch completes the moment the last item closes.
type Receiving struct {
	st      *store.Store
	audit   *audit.Log
	batches *Batches
	vtx     *VendorTransactions
}

func NewReceiving(st *store.Store, a *audit.Log, b *Batches, v *VendorTransactions) *Receiving {
	return &Receiving{st: st, audit: a, batches: b, vtx: v}
}

const (
	maxReceiptNote    = 500
	maxExceptionText  = 2000
	maxResolutionNote = 1000
	maxAdjustReason   = 500
)

func (s *Receiving) loadItem(ctx context.Context, actor authz.Actor, id bson.ObjectID) (*domain.Item, *domain.Batch, *domain.Team, error) {
	it, err := s.st.GetItem(ctx, id)
	if err != nil {
		return nil, nil, nil, mapStore(err)
	}
	b, t, err := s.batches.load(ctx, actor, it.BatchID)
	if err != nil {
		return nil, nil, nil, err
	}
	return it, b, t, nil
}

// ListReceipts returns an item's receiving records to anyone who can read its batch.
func (s *Receiving) ListReceipts(ctx context.Context, actor authz.Actor, itemID bson.ObjectID) ([]domain.Receipt, error) {
	if _, _, _, err := s.loadItem(ctx, actor, itemID); err != nil {
		return nil, err
	}
	out, err := s.st.ListReceipts(ctx, itemID)
	if out == nil {
		out = []domain.Receipt{}
	}
	return out, err
}

// ListExceptions returns an item's exceptions (resolved ones included) to
// anyone who can read its batch.
func (s *Receiving) ListExceptions(ctx context.Context, actor authz.Actor, itemID bson.ObjectID) ([]domain.Exception, error) {
	if _, _, _, err := s.loadItem(ctx, actor, itemID); err != nil {
		return nil, err
	}
	out, err := s.st.ListExceptions(ctx, itemID)
	if out == nil {
		out = []domain.Exception{}
	}
	return out, err
}

// authorizeReceiving: receivers and purchasers (team admins implicitly both,
// system admins neither), archived teams are read-only, batch `receiving`.
func authorizeReceiving(actor authz.Actor, b *domain.Batch, t *domain.Team) error {
	as := authzAssignments(b.Assignments)
	if !actor.HasBatchRole(t.ID, as, authz.BatchReceiver) && !actor.HasBatchRole(t.ID, as, authz.BatchPurchaser) {
		return ErrForbidden
	}
	return receivingState(b, t)
}

func authorizePurchaser(actor authz.Actor, b *domain.Batch, t *domain.Team) error {
	if !actor.HasBatchRole(t.ID, authzAssignments(b.Assignments), authz.BatchPurchaser) {
		return ErrForbidden
	}
	return nil
}

func receivingState(b *domain.Batch, t *domain.Team) error {
	if t.Archived {
		return Rule("team_archived", "Archived teams are read-only.")
	}
	if b.Status != domain.BatchReceiving {
		return Rule("batch_not_receiving", "This can only be done while the batch is in receiving.")
	}
	return nil
}

// ---- receipts ----

type ReceiptInput struct {
	Quantity int
	Note     string
}

// ReceiptResult is a recorded receipt with the item and batch it changed.
type ReceiptResult struct {
	Receipt *domain.Receipt `json:"receipt"`
	Item    *domain.Item    `json:"item"`
	Batch   *domain.Batch   `json:"batch"`
}

// RecordReceipt records that `Quantity` more units of an item arrived. The
// item becomes partially_received or received; goods beyond the ordered
// quantity must be reported as an exception instead.
func (s *Receiving) RecordReceipt(ctx context.Context, actor authz.Actor, itemID bson.ObjectID, version int64, in ReceiptInput) (*ReceiptResult, error) {
	it, b, t, err := s.loadItem(ctx, actor, itemID)
	if err != nil {
		return nil, err
	}
	if err := authorizeReceiving(actor, b, t); err != nil {
		return nil, err
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > maxReceiptNote {
		return nil, Invalid("note", "at most 500 characters")
	}
	if in.Quantity < 1 {
		return nil, Invalid("quantity", "must be at least 1")
	}
	to, received, err := domain.Receive(it.Status, it.Quantity, it.ReceivedQuantity, in.Quantity)
	if err != nil {
		if errors.Is(err, domain.ErrReceiptExceeds) {
			return nil, Rule("receipt_exceeds_quantity",
				"Item #%d has %d of %d received; report extra goods as an exception.", it.SeqNo, it.ReceivedQuantity, it.Quantity)
		}
		return nil, ruleFromDomain(err)
	}
	if it.OrderID == nil {
		return nil, Rule("item_not_ordered", "Item #%d is not part of an order.", it.SeqNo)
	}
	rc := &domain.Receipt{
		ItemID: it.ID, OrderID: *it.OrderID, TeamID: it.TeamID, Quantity: in.Quantity,
		ReceivedBy: actor.UserID, ReceivedAt: s.batches.now(), Note: note,
	}
	res := &ReceiptResult{Receipt: rc}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		ni, err := s.st.UpdateItem(ctx, it.ID, version, bson.D{
			{Key: "status", Value: to}, {Key: "receivedQuantity", Value: received},
		})
		if err != nil {
			return mapStore(err)
		}
		res.Item = ni
		if err := s.st.InsertReceipt(ctx, rc); err != nil {
			return err
		}
		if err := s.audit.Record(ctx, itemEvent(actor.UserID.Hex(), b, ni, "item.received", note,
			domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)},
			domain.AuditChange{Field: "receivedQuantity", From: it.ReceivedQuantity, To: received})); err != nil {
			return err
		}
		return s.batches.reevaluateTx(ctx, b.ID)
	})
	if err != nil {
		return nil, err
	}
	return res, s.reloadBatch(ctx, &res.Batch, b.ID)
}

func (s *Receiving) reloadBatch(ctx context.Context, out **domain.Batch, id bson.ObjectID) error {
	nb, err := s.st.GetBatch(ctx, id)
	if err != nil {
		return mapStore(err)
	}
	*out = nb
	return nil
}

// ---- exceptions ----

type ExceptionInput struct {
	Type        domain.ExceptionType
	Description string
}

// ExceptionResult is an exception with the item and batch it concerns; a
// refund booked while resolving it is in Adjustment.
type ExceptionResult struct {
	Exception  *domain.Exception  `json:"exception"`
	Item       *domain.Item       `json:"item"`
	Batch      *domain.Batch      `json:"batch"`
	Adjustment *domain.Adjustment `json:"adjustment"`
}

// ReportException puts an item that is waiting for goods into `exception`.
// The batch cannot complete until a purchaser has resolved it.
func (s *Receiving) ReportException(ctx context.Context, actor authz.Actor, itemID bson.ObjectID, version int64, in ExceptionInput) (*ExceptionResult, error) {
	it, b, t, err := s.loadItem(ctx, actor, itemID)
	if err != nil {
		return nil, err
	}
	if err := authorizeReceiving(actor, b, t); err != nil {
		return nil, err
	}
	if !in.Type.Valid() {
		return nil, Invalid("type", "must be quantity_mismatch, wrong_item or damaged")
	}
	desc := strings.TrimSpace(in.Description)
	if desc == "" || utf8.RuneCountInString(desc) > maxExceptionText {
		return nil, Invalid("description", "required, at most 2000 characters")
	}
	to, err := domain.ReportException(it.Status)
	if err != nil {
		return nil, ruleFromDomain(err)
	}
	exc := &domain.Exception{
		ItemID: it.ID, TeamID: it.TeamID, Type: in.Type, Description: desc,
		ReportedBy: actor.UserID, ReportedAt: s.batches.now(),
	}
	res := &ExceptionResult{Exception: exc}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		ni, err := s.st.UpdateItem(ctx, it.ID, version, bson.D{{Key: "status", Value: to}})
		if err != nil {
			return mapStore(err)
		}
		res.Item = ni
		if err := s.st.InsertException(ctx, exc); err != nil {
			return err
		}
		if err := s.audit.Record(ctx, itemEvent(actor.UserID.Hex(), b, ni, "item.exception_reported", desc,
			domain.AuditChange{Field: "status", From: string(it.Status), To: string(to)},
			domain.AuditChange{Field: "exceptionType", From: "", To: string(in.Type)})); err != nil {
			return err
		}
		return s.batches.reevaluateTx(ctx, b.ID)
	})
	if err != nil {
		return nil, err
	}
	return res, s.reloadBatch(ctx, &res.Batch, b.ID)
}

type ResolveInput struct {
	Action domain.ExceptionAction
	Note   string
	// Refund is a positive base-currency amount; accept and cancel only.
	Refund *decimal.Decimal
}

// Resolve dispositions an open exception (purchasers, batch `receiving`).
// exchange sends the item back to waiting for goods; accept closes it with
// what was received; cancel gives up on it. A refund (accept and cancel)
// becomes a negative adjustment of the item's order, recomputing its totals.
func (s *Receiving) Resolve(ctx context.Context, actor authz.Actor, excID bson.ObjectID, version int64, in ResolveInput) (*ExceptionResult, error) {
	exc, err := s.st.GetException(ctx, excID)
	if err != nil {
		return nil, mapStore(err)
	}
	it, b, t, err := s.loadItem(ctx, actor, exc.ItemID)
	if err != nil {
		return nil, err
	}
	if err := authorizePurchaser(actor, b, t); err != nil {
		return nil, err
	}
	if err := receivingState(b, t); err != nil {
		return nil, err
	}
	if !in.Action.Valid() {
		return nil, Invalid("action", "must be exchange, accept or cancel")
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > maxResolutionNote {
		return nil, Invalid("note", "at most 1000 characters")
	}
	if in.Refund != nil {
		if n := s.batches.cur.Digits(s.batches.cur.Base); !domain.FitsDigits(*in.Refund, n) {
			return nil, Invalid("refundAmountBase", fmt.Sprintf("at most %d fractional digits for %s", n, s.batches.cur.Base))
		}
	}
	if exc.Resolved() {
		return nil, Rule("exception_resolved", "This exception has already been resolved.")
	}
	if exc.Version != version {
		return nil, ErrVersionConflict
	}

	res := &ExceptionResult{}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		cur, err := s.st.GetItem(ctx, it.ID) // decide on the item as of this transaction
		if err != nil {
			return mapStore(err)
		}
		out, err := domain.Resolve(domain.ResolveInput{
			Action: in.Action, Status: cur.Status, ReceivedQty: cur.ReceivedQuantity, Note: note, Refund: in.Refund,
		})
		if err != nil {
			return resolveRule(err)
		}
		resolution := &domain.Resolution{Action: in.Action, By: actor.UserID, At: s.batches.now(), Note: note}
		if in.Refund != nil {
			resolution.RefundAmountBase = &domain.Decimal{Decimal: *in.Refund}
		}
		ne, err := s.st.UpdateException(ctx, exc.ID, version, bson.D{{Key: "resolution", Value: resolution}})
		if err != nil {
			return mapStore(err)
		}
		res.Exception = ne
		set := bson.D{{Key: "status", Value: out.To}}
		if out.CloseReason != "" {
			set = append(set, bson.E{Key: "closeReason", Value: out.CloseReason})
		}
		ni, err := s.st.UpdateItem(ctx, cur.ID, cur.Version, set)
		if err != nil {
			return mapStore(err)
		}
		res.Item = ni
		a := actor.UserID.Hex()
		changes := []domain.AuditChange{
			{Field: "status", From: string(cur.Status), To: string(out.To)},
			{Field: "resolution", From: "", To: string(in.Action)},
		}
		if in.Refund != nil {
			changes = append(changes, domain.AuditChange{Field: "refundAmountBase", From: "", To: in.Refund.String()})
		}
		evs := []domain.AuditEvent{itemEvent(a, b, ni, "item.exception_resolved", note, changes...)}
		if !out.Adjustment.IsZero() {
			if cur.OrderID == nil {
				return Rule("item_not_ordered", "Item #%d is not part of an order.", cur.SeqNo)
			}
			order, err := s.st.GetOrder(ctx, *cur.OrderID)
			if err != nil {
				return mapStore(err)
			}
			reason := "exception resolution (" + string(in.Action) + "): " + note
			adj, ev, err := s.bookAdjustment(ctx, actor.UserID, b, order, &cur.ID, out.Adjustment, reason)
			if err != nil {
				return err
			}
			res.Adjustment = adj
			evs = append(evs, ev)
		}
		if err := s.audit.Record(ctx, evs...); err != nil {
			return err
		}
		return s.batches.reevaluateTx(ctx, b.ID)
	})
	if err != nil {
		return nil, err
	}
	return res, s.reloadBatch(ctx, &res.Batch, b.ID)
}

func resolveRule(err error) error {
	switch {
	case errors.Is(err, domain.ErrNoteRequired):
		return Invalid("note", "required to accept a short delivery or to cancel")
	case errors.Is(err, domain.ErrRefundNotAllowed):
		return Invalid("refundAmountBase", "a refund can only be recorded with accept or cancel")
	case errors.Is(err, domain.ErrRefundNotPositive):
		return Invalid("refundAmountBase", "must be greater than zero")
	case errors.Is(err, domain.ErrNothingReceived):
		return Rule("nothing_received", "Nothing was received, so there is nothing to accept; cancel the item instead.")
	}
	return ruleFromDomain(err)
}

// ---- adjustments ----

type AdjustmentInput struct {
	AmountBase decimal.Decimal // negative for a refund
	Reason     string
	ItemID     *bson.ObjectID // optional: the item the correction is about
}

// AdjustmentResult is the new adjustment with the order whose totals it changed.
type AdjustmentResult struct {
	Adjustment *domain.Adjustment `json:"adjustment"`
	Order      *domain.Order      `json:"order"`
}

// AddAdjustment books a base-currency correction (refunds are negative) on a
// placed order (purchasers). The order's adjustmentsBase and totalBase are
// recomputed in the same transaction (spec §11 step 8).
func (s *Receiving) AddAdjustment(ctx context.Context, actor authz.Actor, orderID bson.ObjectID, version int64, in AdjustmentInput) (*AdjustmentResult, error) {
	o, err := s.st.GetOrder(ctx, orderID)
	if err != nil {
		return nil, mapStore(err)
	}
	b, t, err := s.batches.load(ctx, actor, o.BatchID)
	if err != nil {
		return nil, err
	}
	if err := authorizePurchaser(actor, b, t); err != nil {
		return nil, err
	}
	if t.Archived {
		return nil, Rule("team_archived", "Archived teams are read-only.")
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > maxAdjustReason {
		return nil, Invalid("reason", "required, at most 500 characters")
	}
	if in.AmountBase.IsZero() {
		return nil, Invalid("amountBase", "must not be zero")
	}
	if n := s.batches.cur.Digits(s.batches.cur.Base); !domain.FitsDigits(in.AmountBase, n) {
		return nil, Invalid("amountBase", fmt.Sprintf("at most %d fractional digits for %s", n, s.batches.cur.Base))
	}
	if in.ItemID != nil && !containsID(o.ItemIDs, *in.ItemID) {
		return nil, Invalid("itemId", "not an item of this order")
	}
	if o.Status != domain.OrderPlaced {
		return nil, Rule("order_not_placed", "Adjustments can only be booked on placed orders.")
	}
	if o.Version != version {
		return nil, ErrVersionConflict
	}
	res := &AdjustmentResult{}
	err = s.st.WithTx(ctx, func(ctx context.Context) error {
		fresh, err := s.st.GetOrder(ctx, o.ID)
		if err != nil {
			return mapStore(err)
		}
		if fresh.Version != version {
			return ErrVersionConflict
		}
		adj, ev, err := s.bookAdjustment(ctx, actor.UserID, b, fresh, in.ItemID, in.AmountBase, reason)
		if err != nil {
			return err
		}
		res.Adjustment = adj
		return s.audit.Record(ctx, ev)
	})
	if err != nil {
		return nil, err
	}
	if res.Order, err = s.st.GetOrder(ctx, o.ID); err != nil {
		return nil, mapStore(err)
	}
	return res, nil
}

func containsID(ids []bson.ObjectID, id bson.ObjectID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// bookAdjustment inserts an adjustment on a placed order and recomputes the
// order's costs, inside the caller's transaction. It returns the audit event
// the caller records.
func (s *Receiving) bookAdjustment(ctx context.Context, actor bson.ObjectID, b *domain.Batch, o *domain.Order,
	itemID *bson.ObjectID, amount decimal.Decimal, reason string) (*domain.Adjustment, domain.AuditEvent, error) {
	if o.Status != domain.OrderPlaced || o.VendorTransactionID == nil {
		return nil, domain.AuditEvent{}, Rule("order_not_placed", "Adjustments can only be booked on placed orders.")
	}
	adj := &domain.Adjustment{
		OrderID: o.ID, TeamID: o.TeamID, ItemID: itemID, AmountBase: domain.Decimal{Decimal: amount},
		Reason: reason, CreatedBy: actor,
	}
	if err := s.st.InsertAdjustment(ctx, adj); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	if err := s.vtx.refreshCosts(ctx, *o.VendorTransactionID); err != nil {
		return nil, domain.AuditEvent{}, err
	}
	no, err := s.st.GetOrder(ctx, o.ID)
	if err != nil {
		return nil, domain.AuditEvent{}, mapStore(err)
	}
	item := ""
	if itemID != nil {
		item = itemID.Hex()
	}
	ev := orderEvent(actor.Hex(), b, no, "order.adjusted",
		domain.AuditChange{Field: "adjustment", From: "", To: amount.String()},
		domain.AuditChange{Field: "reason", From: "", To: reason},
		domain.AuditChange{Field: "itemId", From: "", To: item},
		domain.AuditChange{Field: "adjustmentsBase", From: o.AdjustmentsBase.String(), To: no.AdjustmentsBase.String()},
		domain.AuditChange{Field: "totalBase", From: o.TotalBase.String(), To: no.TotalBase.String()})
	ev.Comment = reason
	return adj, ev, nil
}
