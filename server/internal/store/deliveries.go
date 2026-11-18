package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

// ---- deliveries ----

func (s *Store) InsertDelivery(ctx context.Context, d *domain.Delivery) error {
	now := time.Now().UTC()
	d.CreatedAt, d.UpdatedAt, d.Version = now, now, 1
	res, err := s.c("deliveries").InsertOne(ctx, d)
	if err != nil {
		return mapErr(err)
	}
	d.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetDelivery(ctx context.Context, id bson.ObjectID) (*domain.Delivery, error) {
	var d domain.Delivery
	if err := s.c("deliveries").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&d); err != nil {
		return nil, mapErr(err)
	}
	return &d, nil
}

// DeliveryFilter narrows ListDeliveries; zero values mean "any".
type DeliveryFilter struct {
	Voided   *bool
	From, To string // receivedAt bounds, YYYY-MM-DD
	Number   int
	Text     string // substring of source or note
	After    bson.ObjectID
}

func (s *Store) ListDeliveries(ctx context.Context, f DeliveryFilter, limit int64) ([]domain.Delivery, error) {
	q := bson.D{}
	if f.Voided != nil {
		if *f.Voided {
			q = append(q, bson.E{Key: "voided", Value: bson.D{{Key: "$ne", Value: nil}}})
		} else {
			q = append(q, bson.E{Key: "voided", Value: nil})
		}
	}
	rng := bson.D{}
	if f.From != "" {
		rng = append(rng, bson.E{Key: "$gte", Value: f.From})
	}
	if f.To != "" {
		rng = append(rng, bson.E{Key: "$lte", Value: f.To})
	}
	if len(rng) > 0 {
		q = append(q, bson.E{Key: "receivedAt", Value: rng})
	}
	var or bson.A
	if f.Number > 0 {
		or = append(or, bson.D{{Key: "number", Value: f.Number}})
	}
	if f.Text != "" {
		re := bson.Regex{Pattern: regexpQuote(f.Text), Options: "i"}
		or = append(or, bson.D{{Key: "source", Value: re}}, bson.D{{Key: "note", Value: re}})
	}
	if len(or) > 0 {
		q = append(q, bson.E{Key: "$or", Value: or})
	}
	if !f.After.IsZero() {
		q = append(q, bson.E{Key: "_id", Value: bson.D{{Key: "$lt", Value: f.After}}})
	}
	cur, err := s.c("deliveries").Find(ctx, q, options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.Delivery
	return out, cur.All(ctx, &out)
}

func (s *Store) UpdateDelivery(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.Delivery, error) {
	var out domain.Delivery
	if err := s.UpdateVersioned(ctx, "deliveries", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- delivery lines ----

func (s *Store) InsertDeliveryLine(ctx context.Context, l *domain.DeliveryLine) error {
	l.CreatedAt = time.Now().UTC()
	res, err := s.c("deliveryLines").InsertOne(ctx, l)
	if err != nil {
		return mapErr(err)
	}
	l.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetDeliveryLine(ctx context.Context, id bson.ObjectID) (*domain.DeliveryLine, error) {
	var l domain.DeliveryLine
	if err := s.c("deliveryLines").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&l); err != nil {
		return nil, mapErr(err)
	}
	return &l, nil
}

func (s *Store) DeliveryLinesOf(ctx context.Context, deliveryID bson.ObjectID) ([]domain.DeliveryLine, error) {
	cur, err := s.c("deliveryLines").Find(ctx, bson.D{{Key: "deliveryId", Value: deliveryID}}, options.Find().SetSort(bson.D{{Key: "lineNo", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.DeliveryLine
	return out, cur.All(ctx, &out)
}

// DeliveryLinesByState lists lines of non-voided deliveries in the given states, oldest first.
func (s *Store) DeliveryLinesByState(ctx context.Context, states []domain.MatchState, limit int64) ([]domain.DeliveryLine, error) {
	cur, err := s.c("deliveryLines").Find(ctx, bson.D{
		{Key: "matchState", Value: bson.D{{Key: "$in", Value: states}}}, {Key: "deliveryVoided", Value: bson.D{{Key: "$ne", Value: true}}},
	}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.DeliveryLine
	return out, cur.All(ctx, &out)
}

func (s *Store) CountPendingDeliveryLines(ctx context.Context) (int, error) {
	n, err := s.c("deliveryLines").CountDocuments(ctx, bson.D{
		{Key: "matchState", Value: bson.D{{Key: "$in", Value: []domain.MatchState{domain.MatchUnmatched, domain.MatchPartial}}}},
		{Key: "deliveryVoided", Value: bson.D{{Key: "$ne", Value: true}}}})
	return int(n), err
}

func (s *Store) SetDeliveryLine(ctx context.Context, id bson.ObjectID, set bson.D) error {
	res, err := s.c("deliveryLines").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, bson.D{{Key: "$set", Value: set}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) MarkDeliveryLinesVoided(ctx context.Context, deliveryID bson.ObjectID) error {
	_, err := s.c("deliveryLines").UpdateMany(ctx, bson.D{{Key: "deliveryId", Value: deliveryID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "deliveryVoided", Value: true}}}})
	return err
}

// ---- matches ----

func (s *Store) InsertMatch(ctx context.Context, m *domain.DeliveryMatch) error {
	now := time.Now().UTC()
	m.CreatedAt, m.UpdatedAt, m.Version = now, now, 1
	res, err := s.c("deliveryMatches").InsertOne(ctx, m)
	if err != nil {
		return mapErr(err)
	}
	m.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

// GetMatch loads one delivery match.
func (s *Store) GetMatch(ctx context.Context, id bson.ObjectID) (*domain.DeliveryMatch, error) {
	var m domain.DeliveryMatch
	if err := s.c("deliveryMatches").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&m); err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}

func (s *Store) findMatches(ctx context.Context, f bson.D) ([]domain.DeliveryMatch, error) {
	cur, err := s.c("deliveryMatches").Find(ctx, f, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.DeliveryMatch
	return out, cur.All(ctx, &out)
}

// ActiveMatchesOfDeliveryLines lists the non-voided matches of the given delivery lines.
func (s *Store) ActiveMatchesOfDeliveryLines(ctx context.Context, ids []bson.ObjectID) ([]domain.DeliveryMatch, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return s.findMatches(ctx, bson.D{{Key: "deliveryLineId", Value: bson.D{{Key: "$in", Value: ids}}}, {Key: "voided", Value: nil}})
}

func (s *Store) ActiveMatchesOfDelivery(ctx context.Context, deliveryID bson.ObjectID) ([]domain.DeliveryMatch, error) {
	return s.findMatches(ctx, bson.D{{Key: "deliveryId", Value: deliveryID}, {Key: "voided", Value: nil}})
}

func (s *Store) VoidMatch(ctx context.Context, id bson.ObjectID, v domain.Void) error {
	res, err := s.c("deliveryMatches").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "voided", Value: nil}}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "voided", Value: v}, {Key: "updatedAt", Value: time.Now().UTC()}}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- problems ----

func (s *Store) InsertProblem(ctx context.Context, p *domain.LineProblem) error {
	now := time.Now().UTC()
	p.CreatedAt, p.UpdatedAt, p.Version = now, now, 1
	res, err := s.c("lineProblems").InsertOne(ctx, p)
	if err != nil {
		return mapErr(err)
	}
	p.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetProblem(ctx context.Context, id bson.ObjectID) (*domain.LineProblem, error) {
	var p domain.LineProblem
	if err := s.c("lineProblems").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&p); err != nil {
		return nil, mapErr(err)
	}
	return &p, nil
}

// ProblemOfMatch returns the non-voided problem a match produced, if any.
func (s *Store) ProblemOfMatch(ctx context.Context, matchID bson.ObjectID) (*domain.LineProblem, error) {
	var p domain.LineProblem
	err := s.c("lineProblems").FindOne(ctx, bson.D{{Key: "deliveryMatchId", Value: matchID}, {Key: "voided", Value: nil}}).Decode(&p)
	if err != nil {
		return nil, mapErr(err)
	}
	return &p, nil
}

// ProblemFilter narrows ListProblems; zero values mean "any".
type ProblemFilter struct {
	Status        string // "open", "resolved" or ""
	VendorOrderID bson.ObjectID
}

// ListProblems lists non-voided problems, newest first.
func (s *Store) ListProblems(ctx context.Context, f ProblemFilter, lineIDs []bson.ObjectID, limit int64) ([]domain.LineProblem, error) {
	q := bson.D{{Key: "voided", Value: nil}}
	switch f.Status {
	case "open":
		q = append(q, bson.E{Key: "resolution", Value: nil})
	case "resolved":
		q = append(q, bson.E{Key: "resolution", Value: bson.D{{Key: "$ne", Value: nil}}})
	}
	if !f.VendorOrderID.IsZero() {
		q = append(q, bson.E{Key: "vendorOrderLineId", Value: bson.D{{Key: "$in", Value: lineIDs}}})
	}
	cur, err := s.c("lineProblems").Find(ctx, q, options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, err
	}
	var out []domain.LineProblem
	return out, cur.All(ctx, &out)
}

func (s *Store) CountOpenProblems(ctx context.Context) (int, error) {
	n, err := s.c("lineProblems").CountDocuments(ctx, bson.D{{Key: "voided", Value: nil}, {Key: "resolution", Value: nil}})
	return int(n), err
}

// CountOpenProblemsOnLines counts open problems on the given lines.
func (s *Store) CountOpenProblemsOnLines(ctx context.Context, lineIDs []bson.ObjectID) (int, error) {
	if len(lineIDs) == 0 {
		return 0, nil
	}
	n, err := s.c("lineProblems").CountDocuments(ctx, bson.D{{Key: "voided", Value: nil}, {Key: "resolution", Value: nil},
		{Key: "vendorOrderLineId", Value: bson.D{{Key: "$in", Value: lineIDs}}}})
	return int(n), err
}

// VoidProblem voids a problem (versioned by its own version).
func (s *Store) VoidProblem(ctx context.Context, id bson.ObjectID, v domain.Void) error {
	res, err := s.c("lineProblems").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "voided", Value: nil}}, bson.D{
		{Key: "$set", Value: bson.D{{Key: "voided", Value: v}, {Key: "updatedAt", Value: time.Now().UTC()}}},
		{Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}})
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdateProblem(ctx context.Context, id bson.ObjectID, version int64, set bson.D) (*domain.LineProblem, error) {
	var out domain.LineProblem
	if err := s.UpdateVersioned(ctx, "lineProblems", id, version, set, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- candidate lines for matching ----

// OpenLines lists lines of placed orders that can still take deliveries
// (status ordered or partially_received, not closed).
func (s *Store) OpenLines(ctx context.Context) ([]domain.VendorOrderLine, error) {
	return s.findLines(ctx, bson.D{
		{Key: "status", Value: bson.D{{Key: "$in", Value: []domain.LineStatus{domain.LineOrdered, domain.LinePartiallyReceived}}}},
		{Key: "closure", Value: nil},
	}, options.Find().SetSort(bson.D{{Key: "vendorOrderId", Value: 1}, {Key: "lineNo", Value: 1}}).SetLimit(3000))
}

// BumpLine increments a line's internal version (the concurrency token of
// matching, resolution and closure, spec §10).
func (s *Store) BumpLine(ctx context.Context, id bson.ObjectID) error {
	return s.UpdateLine(ctx, id, bson.D{})
}
