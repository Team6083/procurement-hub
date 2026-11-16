package service

import (
	"context"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// itemLine is the slice of a linked vendor order line the item's computed
// fields depend on (non-cancelled orders only; spec §9.1, §10.2).
type itemLine struct {
	ID            bson.ObjectID
	VendorOrderID bson.ObjectID
	LineNo        int
	Status        domain.LineStatus
	Quantity      int
	Received      int
	CostBase      *domain.Decimal // nil while incomplete
}

// linesOf loads the linked lines of an item on non-cancelled orders; a line
// that is only draft still counts toward the planned quantity.
func (s *Batches) linesOf(ctx context.Context, itemID bson.ObjectID) ([]itemLine, error) {
	lines, err := s.st.LinesByItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	var out []itemLine
	for _, l := range lines {
		if l.Status == domain.LineCancelled {
			continue
		}
		out = append(out, itemLine{ID: l.ID, VendorOrderID: l.VendorOrderID, LineNo: l.LineNo, Status: l.Status, Quantity: l.Quantity, Received: l.ReceivedQty, CostBase: l.TotalBase})
	}
	return out, nil
}

// placedLinesOf lists placed lines of an item as undo blockers.
func (s *Batches) placedLinesOf(ctx context.Context, itemID bson.ObjectID) ([]Blocker, error) {
	lines, err := s.st.LinesByItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	var out []Blocker
	for _, l := range lines {
		if l.Status != domain.LineDraft && l.Status != domain.LineCancelled {
			o, err := s.st.GetVendorOrder(ctx, l.VendorOrderID)
			if err != nil {
				return nil, mapStore(err)
			}
			out = append(out, Blocker{Type: "vendor_order", ID: o.ID.Hex(), Label: "VO-" + itoa(o.Number)})
		}
	}
	return out, nil
}

// removeDraftLinesOf deletes the draft lines of an item (the only place undo
// deletes; the content goes to audit, spec §10 intro) and recomputes the
// orders they were on. The returned events belong to the caller's audit batch.
func (s *Batches) removeDraftLinesOf(ctx context.Context, b *domain.Batch, it *domain.Item, actor string) ([]domain.AuditEvent, error) {
	lines, err := s.st.LinesByItem(ctx, it.ID)
	if err != nil {
		return nil, err
	}
	var evs []domain.AuditEvent
	for _, l := range lines {
		if l.Status != domain.LineDraft {
			continue
		}
		o, err := s.st.GetVendorOrder(ctx, l.VendorOrderID)
		if err != nil {
			return nil, mapStore(err)
		}
		price := ""
		if l.UnitPrice != nil {
			price = l.UnitPrice.String()
		}
		if err := s.st.DeleteLine(ctx, l.ID); err != nil {
			return nil, err
		}
		evs = append(evs, domain.AuditEvent{
			Actor: actor, TeamIDs: []bson.ObjectID{l.TeamID}, BatchID: b.ID, ObjectType: "vendor_order", ObjectID: o.ID.Hex(),
			Action: "vendor_order.line_removed", Scope: "line", LineIDs: []string{l.ID.Hex()},
			Comment: "review confirmation was undone",
			Changes: []domain.AuditChange{
				{Field: "line", From: "#" + itoa(l.LineNo) + " " + l.Name + " x" + itoa(l.Quantity) + " sku=" + l.SKU + " unitPrice=" + price, To: nil},
			},
		})
		if _, _, err := s.recomputeOrder(ctx, o, recomputeOpts{skipItems: true}); err != nil {
			return nil, err
		}
	}
	return evs, nil
}

// refreshItem recomputes the item's computed purchasing fields from its linked
// lines and the batch's confirmation, bumping the item version.
func (s *Batches) refreshItem(ctx context.Context, b *domain.Batch, it *domain.Item) error {
	lines, err := s.linesOf(ctx, it.ID)
	if err != nil {
		return err
	}
	planned, ordered, received := 0, 0, 0
	var views []domain.LineView
	cost := decimal.Zero
	hasPlaced, costKnown := false, true
	for _, l := range lines {
		planned += l.Quantity
		views = append(views, domain.LineView{Status: l.Status})
		if l.Status == domain.LineDraft {
			continue
		}
		hasPlaced = true
		ordered += l.Quantity
		received += l.Received
		if l.CostBase == nil {
			costKnown = false
		} else {
			cost = cost.Add(l.CostBase.Decimal)
		}
	}
	toPurchase := it.Quantity - planned
	if toPurchase < 0 || it.Unpurchasable != nil {
		toPurchase = 0
	}
	external := b.ReviewConfirmation != nil && b.ReviewConfirmation.PurchaseOutside
	f := domain.DeriveFulfillment(domain.FulfillmentInput{
		External: external, Unpurchasable: it.Unpurchasable != nil, ToPurchaseQty: toPurchase, Lines: views,
	})
	set := bson.D{
		{Key: "fulfillment", Value: f}, {Key: "plannedQuantity", Value: planned}, {Key: "toPurchaseQuantity", Value: toPurchase},
		{Key: "orderedQuantity", Value: ordered}, {Key: "receivedQuantity", Value: received},
	}
	if hasPlaced && costKnown {
		set = append(set, bson.E{Key: "costBase", Value: domain.Decimal{Decimal: cost}})
	} else {
		set = append(set, bson.E{Key: "costBase", Value: nil})
	}
	if external {
		set[1].Value, set[2].Value = 0, 0
	}
	_, err = s.st.UpdateItem(ctx, it.ID, it.Version, set)
	return mapStore(err)
}
