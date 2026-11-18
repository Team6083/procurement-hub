package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// NextCounter atomically allocates the next system-wide number of a series
// ("vendorOrder", "delivery"; spec §9.1).
func (s *Store) NextCounter(ctx context.Context, name string) (int, error) {
	var c struct {
		Seq int `bson:"seq"`
	}
	err := s.c("counters").FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: name}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "seq", Value: 1}}}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)).Decode(&c)
	if err != nil {
		return 0, mapErr(err)
	}
	return c.Seq, nil
}

// ---- vendor orders ----

func (s *Store) InsertVendorOrder(ctx context.Context, o *domain.VendorOrder) error {
	now := time.Now().UTC()
	o.CreatedAt, o.UpdatedAt, o.Version = now, now, 1
	ensureOrderSlices(o)
	res, err := s.c("vendorOrders").InsertOne(ctx, o)
	if err != nil {
		return mapErr(err)
	}
	o.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func ensureOrderSlices(o *domain.VendorOrder) {
	if o.OwnerIDs == nil {
		o.OwnerIDs = []bson.ObjectID{}
	}
	if o.SharedCosts == nil {
		o.SharedCosts = []domain.SharedCost{}
	}
	if o.TeamIDs == nil {
		o.TeamIDs = []bson.ObjectID{}
	}
	if o.BatchIDs == nil {
		o.BatchIDs = []bson.ObjectID{}
	}
	if o.Totals.Incomplete == nil {
		o.Totals.Incomplete = []domain.Incomplete{}
	}
}

func (s *Store) GetVendorOrder(ctx context.Context, id bson.ObjectID) (*domain.VendorOrder, error) {
	var o domain.VendorOrder
	if err := s.c("vendorOrders").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&o); err != nil {
		return nil, mapErr(err)
	}
	return &o, nil
}

// OrderFilter narrows ListVendorOrders; zero values mean "any".
type OrderFilter struct {
	Status   domain.OrderStatus
	VendorID bson.ObjectID
	TeamID   bson.ObjectID
	OwnerID  bson.ObjectID // orders that list this user as an owner
	Number   int           // exact number, from q such as "VO-12" or "12"
	ExtNo    string        // substring of the vendor's order number
	After    bson.ObjectID
}

// ListVendorOrders returns orders newest first (by _id).
func (s *Store) ListVendorOrders(ctx context.Context, f OrderFilter, limit int64) ([]domain.VendorOrder, error) {
	q := bson.D{}
	if f.Status != "" {
		q = append(q, bson.E{Key: "status", Value: f.Status})
	}
	if !f.VendorID.IsZero() {
		q = append(q, bson.E{Key: "vendorId", Value: f.VendorID})
	}
	if !f.TeamID.IsZero() {
		q = append(q, bson.E{Key: "teamIds", Value: f.TeamID})
	}
	if !f.OwnerID.IsZero() {
		q = append(q, bson.E{Key: "ownerIds", Value: f.OwnerID})
	}
	var or bson.A
	if f.Number > 0 {
		or = append(or, bson.D{{Key: "number", Value: f.Number}})
	}
	if f.ExtNo != "" {
		or = append(or, bson.D{{Key: "externalOrderNo", Value: bson.Regex{Pattern: regexpQuote(f.ExtNo), Options: "i"}}})
	}
	if len(or) > 0 {
		q = append(q, bson.E{Key: "$or", Value: or})
	}
	if !f.After.IsZero() {
		q = append(q, bson.E{Key: "_id", Value: bson.D{{Key: "$lt", Value: f.After}}})
	}
	cur, err := s.c("vendorOrders").Find(ctx, q, options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.VendorOrder
	return out, cur.All(ctx, &out)
}

func (s *Store) UpdateVendorOrder(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.VendorOrder, error) {
	var out domain.VendorOrder
	if err := s.UpdateVersioned(ctx, "vendorOrders", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// OrdersToRecompute lists non-cancelled orders in a currency without a charged amount.
func (s *Store) OrdersToRecompute(ctx context.Context, currency string) ([]bson.ObjectID, error) {
	cur, err := s.c("vendorOrders").Find(ctx, bson.D{
		{Key: "currency", Value: currency}, {Key: "status", Value: bson.D{{Key: "$ne", Value: domain.OrderCancelled}}},
		{Key: "chargedAmountBase", Value: nil},
	}, options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	ids := make([]bson.ObjectID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	return ids, nil
}

// CountDraftOrders counts draft vendor orders (the purchaser's task counter).
func (s *Store) CountDraftOrders(ctx context.Context) (int, error) {
	n, err := s.c("vendorOrders").CountDocuments(ctx, bson.D{{Key: "status", Value: domain.OrderDraft}})
	return int(n), err
}

// CountDraftOrdersOwnedBy counts draft vendor orders that list the user as an owner.
func (s *Store) CountDraftOrdersOwnedBy(ctx context.Context, user bson.ObjectID) (int, error) {
	n, err := s.c("vendorOrders").CountDocuments(ctx, bson.D{{Key: "status", Value: domain.OrderDraft}, {Key: "ownerIds", Value: user}})
	return int(n), err
}

// OrderIDsOwnedBy lists the ids of the orders that list the user as an owner.
func (s *Store) OrderIDsOwnedBy(ctx context.Context, user bson.ObjectID) ([]bson.ObjectID, error) {
	cur, err := s.c("vendorOrders").Find(ctx, bson.D{{Key: "ownerIds", Value: user}}, options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	ids := make([]bson.ObjectID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	return ids, nil
}

// ---- lines ----

func (s *Store) InsertLine(ctx context.Context, l *domain.VendorOrderLine) error {
	now := time.Now().UTC()
	l.CreatedAt, l.UpdatedAt, l.InternalVersion = now, now, 1
	res, err := s.c("vendorOrderLines").InsertOne(ctx, l)
	if err != nil {
		return mapErr(err)
	}
	l.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetLine(ctx context.Context, id bson.ObjectID) (*domain.VendorOrderLine, error) {
	var l domain.VendorOrderLine
	if err := s.c("vendorOrderLines").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&l); err != nil {
		return nil, mapErr(err)
	}
	return &l, nil
}

func (s *Store) findLines(ctx context.Context, f bson.D, opts ...options.Lister[options.FindOptions]) ([]domain.VendorOrderLine, error) {
	cur, err := s.c("vendorOrderLines").Find(ctx, f, opts...)
	if err != nil {
		return nil, err
	}
	var out []domain.VendorOrderLine
	return out, cur.All(ctx, &out)
}

func (s *Store) LinesByOrder(ctx context.Context, orderID bson.ObjectID) ([]domain.VendorOrderLine, error) {
	return s.findLines(ctx, bson.D{{Key: "vendorOrderId", Value: orderID}}, options.Find().SetSort(bson.D{{Key: "lineNo", Value: 1}}))
}

func (s *Store) LinesByOrders(ctx context.Context, orderIDs []bson.ObjectID) ([]domain.VendorOrderLine, error) {
	if len(orderIDs) == 0 {
		return nil, nil
	}
	return s.findLines(ctx, bson.D{{Key: "vendorOrderId", Value: bson.D{{Key: "$in", Value: orderIDs}}}})
}

func (s *Store) LinesByItem(ctx context.Context, itemID bson.ObjectID) ([]domain.VendorOrderLine, error) {
	return s.findLines(ctx, bson.D{{Key: "itemId", Value: itemID}}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
}

func (s *Store) LinesByIDs(ctx context.Context, ids []bson.ObjectID) ([]domain.VendorOrderLine, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return s.findLines(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
}

// LinesToClose lists placed, unclosed lines that have received something but
// not everything and have no open problem (spec §16.2).
func (s *Store) LinesToClose(ctx context.Context) ([]domain.VendorOrderLine, error) {
	return s.findLines(ctx, bson.D{
		{Key: "status", Value: domain.LinePartiallyReceived}, {Key: "closure", Value: nil},
		{Key: "openProblemQuantity", Value: 0},
	}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(500))
}

// UpdateLine applies `set` to a line and bumps its internal version.
func (s *Store) UpdateLine(ctx context.Context, id bson.ObjectID, set bson.D) error {
	set = append(set, bson.E{Key: "updatedAt", Value: time.Now().UTC()})
	res, err := s.c("vendorOrderLines").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}},
		bson.D{{Key: "$set", Value: set}, {Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteLine(ctx context.Context, id bson.ObjectID) error {
	_, err := s.c("vendorOrderLines").DeleteOne(ctx, bson.D{{Key: "_id", Value: id}})
	return err
}

// ---- ledger ----

func (s *Store) InsertLedger(ctx context.Context, e *domain.LedgerEntry) error {
	now := time.Now().UTC()
	e.CreatedAt, e.UpdatedAt = now, now
	res, err := s.c("ledgerEntries").InsertOne(ctx, e)
	if err != nil {
		return mapErr(err)
	}
	e.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetLedger(ctx context.Context, id bson.ObjectID) (*domain.LedgerEntry, error) {
	var e domain.LedgerEntry
	if err := s.c("ledgerEntries").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&e); err != nil {
		return nil, mapErr(err)
	}
	return &e, nil
}

// LedgerByOrder lists an order's entries (voided ones included) oldest first.
func (s *Store) LedgerByOrder(ctx context.Context, orderID bson.ObjectID) ([]domain.LedgerEntry, error) {
	cur, err := s.c("ledgerEntries").Find(ctx, bson.D{{Key: "vendorOrderId", Value: orderID}}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.LedgerEntry
	return out, cur.All(ctx, &out)
}

// VoidLedger marks an entry voided (it stays for audit).
func (s *Store) VoidLedger(ctx context.Context, id bson.ObjectID, v domain.Void) error {
	res, err := s.c("ledgerEntries").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "voided", Value: nil}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "voided", Value: v}, {Key: "updatedAt", Value: time.Now().UTC()}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- matches and problems (written by deliveries, read for line quantities) ----

// MatchesByLines lists the non-voided matches of the given lines.
func (s *Store) ActiveMatchesByLines(ctx context.Context, lineIDs []bson.ObjectID) ([]domain.DeliveryMatch, error) {
	if len(lineIDs) == 0 {
		return nil, nil
	}
	cur, err := s.c("deliveryMatches").Find(ctx, bson.D{
		{Key: "vendorOrderLineId", Value: bson.D{{Key: "$in", Value: lineIDs}}}, {Key: "voided", Value: nil}})
	if err != nil {
		return nil, err
	}
	var out []domain.DeliveryMatch
	return out, cur.All(ctx, &out)
}

// ActiveProblemsByLines lists the non-voided problems of the given lines.
func (s *Store) ActiveProblemsByLines(ctx context.Context, lineIDs []bson.ObjectID) ([]domain.LineProblem, error) {
	if len(lineIDs) == 0 {
		return nil, nil
	}
	cur, err := s.c("lineProblems").Find(ctx, bson.D{
		{Key: "vendorOrderLineId", Value: bson.D{{Key: "$in", Value: lineIDs}}}, {Key: "voided", Value: nil}})
	if err != nil {
		return nil, err
	}
	var out []domain.LineProblem
	return out, cur.All(ctx, &out)
}

// BumpOrder increments an order's version without changing anything else.
func (s *Store) BumpOrder(ctx context.Context, id bson.ObjectID) error {
	res, err := s.c("vendorOrders").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, bson.D{
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}},
		{Key: "$set", Value: bson.D{{Key: "updatedAt", Value: time.Now().UTC()}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

var _ = mongo.ErrNoDocuments

// DeliveryNumbers maps delivery ids to their DL numbers (for blocker labels).
func (s *Store) DeliveryNumbers(ctx context.Context, ids []bson.ObjectID) (map[bson.ObjectID]int, error) {
	out := map[bson.ObjectID]int{}
	if len(ids) == 0 {
		return out, nil
	}
	cur, err := s.c("deliveries").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}},
		options.Find().SetProjection(bson.D{{Key: "number", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID     bson.ObjectID `bson:"_id"`
		Number int           `bson:"number"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = r.Number
	}
	return out, nil
}
