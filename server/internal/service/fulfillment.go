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
	ID       bson.ObjectID
	Status   domain.LineStatus
	Quantity int
	Received int
	CostBase *domain.Decimal // nil while incomplete
}

// linesOf loads the linked lines of an item. Lines arrive with the vendor
// order collections; until then every item has none.
func (s *Batches) linesOf(ctx context.Context, itemID bson.ObjectID) ([]itemLine, error) {
	return nil, nil
}

// placedLinesOf lists placed lines of an item as undo blockers.
func (s *Batches) placedLinesOf(ctx context.Context, itemID bson.ObjectID) ([]Blocker, error) {
	lines, err := s.linesOf(ctx, itemID)
	if err != nil {
		return nil, err
	}
	var out []Blocker
	for _, l := range lines {
		if l.Status != domain.LineDraft && l.Status != domain.LineCancelled {
			out = append(out, Blocker{Type: "vendor_order_line", ID: l.ID.Hex(), Label: string(l.Status)})
		}
	}
	return out, nil
}

// removeDraftLinesOf deletes draft lines of an item (the only place undo
// deletes; the content goes to audit, spec §10 intro). Wired for 4b.
func (s *Batches) removeDraftLinesOf(ctx context.Context, b *domain.Batch, it *domain.Item, actor string) ([]domain.AuditEvent, error) {
	return nil, nil
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
