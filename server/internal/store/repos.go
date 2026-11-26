package store

import (
	"context"
	"errors"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrVersionConflict = errors.New("version conflict")
	ErrDuplicate       = errors.New("duplicate")
)

func mapErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, mongo.ErrNoDocuments):
		return ErrNotFound
	case mongo.IsDuplicateKeyError(err):
		return ErrDuplicate
	}
	return err
}

func (s *Store) c(name string) *mongo.Collection { return s.DB.Collection(name) }

// UpdateVersioned applies `set` (plus updatedAt and version+1) to the document
// if its current version equals expected; otherwise ErrVersionConflict.
// The updated document is decoded into out.
func (s *Store) UpdateVersioned(ctx context.Context, coll string, id bson.ObjectID, expected int64, set bson.D, out any) error {
	set = append(set, bson.E{Key: "updatedAt", Value: time.Now().UTC()})
	res := s.c(coll).FindOneAndUpdate(ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "version", Value: expected}},
		bson.D{{Key: "$set", Value: set}, {Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After))
	if err := res.Decode(out); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			// Distinguish missing from stale.
			n, cerr := s.c(coll).CountDocuments(ctx, bson.D{{Key: "_id", Value: id}})
			if cerr == nil && n > 0 {
				return ErrVersionConflict
			}
			return ErrNotFound
		}
		return mapErr(err)
	}
	return nil
}

// ---- users ----

// UpsertUser creates the user for sub if unknown and returns the current doc.
func (s *Store) UpsertUser(ctx context.Context, sub, username, email, displayName string) (*domain.User, error) {
	now := time.Now().UTC()
	var u domain.User
	err := s.c("users").FindOneAndUpdate(ctx,
		bson.D{{Key: "sub", Value: sub}},
		bson.D{{Key: "$setOnInsert", Value: bson.D{
			{Key: "sub", Value: sub}, {Key: "username", Value: username}, {Key: "email", Value: email},
			{Key: "displayName", Value: displayName},
			{Key: "lastSyncedTokenIat", Value: time.Time{}},
			{Key: "createdAt", Value: now}, {Key: "updatedAt", Value: now}, {Key: "version", Value: int64(1)},
		}}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)).Decode(&u)
	if err != nil {
		return nil, mapErr(err)
	}
	return &u, nil
}

// MarkSynced refreshes profile fields and lastSyncedTokenIat, but only moves
// the timestamp forward.
func (s *Store) MarkSynced(ctx context.Context, userID bson.ObjectID, iat time.Time, username, email, displayName string, snap domain.RoleSnapshot) error {
	_, err := s.c("users").UpdateOne(ctx,
		bson.D{{Key: "_id", Value: userID}, {Key: "lastSyncedTokenIat", Value: bson.D{{Key: "$lt", Value: iat}}}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "lastSyncedTokenIat", Value: iat}, {Key: "username", Value: username},
			{Key: "email", Value: email}, {Key: "displayName", Value: displayName},
			{Key: "roleSnapshot", Value: snap},
			{Key: "updatedAt", Value: time.Now().UTC()},
		}}})
	return err
}

func (s *Store) GetUser(ctx context.Context, id bson.ObjectID) (*domain.User, error) {
	var u domain.User
	if err := s.c("users").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&u); err != nil {
		return nil, mapErr(err)
	}
	return &u, nil
}

// UsersByIDs loads users in one query; missing ids are simply absent.
func (s *Store) UsersByIDs(ctx context.Context, ids []bson.ObjectID) (map[bson.ObjectID]domain.User, error) {
	out := map[bson.ObjectID]domain.User{}
	if len(ids) == 0 {
		return out, nil
	}
	cur, err := s.c("users").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}})
	if err != nil {
		return nil, err
	}
	var rows []domain.User
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	for _, u := range rows {
		out[u.ID] = u
	}
	return out, nil
}

// PurchaserIDs returns those of ids that still have the purchaser role in
// users.roleSnapshot, keeping the order of ids.
func (s *Store) PurchaserIDs(ctx context.Context, ids []bson.ObjectID) ([]bson.ObjectID, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := s.c("users").Find(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}, {Key: "roleSnapshot.purchaser", Value: true}},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	ok := map[bson.ObjectID]bool{}
	for _, r := range rows {
		ok[r.ID] = true
	}
	var out []bson.ObjectID
	for _, id := range ids {
		if ok[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

// SearchUsers matches username, email or display name by case-insensitive prefix/substring.
// role is "", "purchaser" or "receiver"; the latter two filter on roleSnapshot.
func (s *Store) SearchUsers(ctx context.Context, q, role string, limit int64) ([]domain.User, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	re := bson.Regex{Pattern: regexp.QuoteMeta(q), Options: "i"}
	filter := bson.D{{Key: "$or", Value: bson.A{
		bson.D{{Key: "username", Value: re}}, bson.D{{Key: "email", Value: re}}, bson.D{{Key: "displayName", Value: re}},
	}}}
	if q == "" {
		filter = bson.D{}
	}
	if role != "" {
		filter = append(filter, bson.E{Key: "roleSnapshot." + role, Value: true})
	}
	cur, err := s.c("users").Find(ctx, filter, options.Find().SetLimit(limit).SetSort(bson.D{{Key: "username", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.User
	return out, cur.All(ctx, &out)
}

// ---- teams ----

func (s *Store) CreateTeam(ctx context.Context, t *domain.Team) error {
	now := time.Now().UTC()
	t.CreatedAt, t.UpdatedAt, t.Version = now, now, 1
	NormalizeTeam(t)
	res, err := s.c("teams").InsertOne(ctx, t)
	if err != nil {
		return mapErr(err)
	}
	t.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

func (s *Store) GetTeam(ctx context.Context, id bson.ObjectID) (*domain.Team, error) {
	var t domain.Team
	if err := s.c("teams").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&t); err != nil {
		return nil, mapErr(err)
	}
	NormalizeTeam(&t)
	return &t, nil
}

// NormalizeTeam gives subgroups of documents written before aliases existed an empty list, so
// the API never returns null.
func NormalizeTeam(t *domain.Team) {
	if t.Subgroups == nil {
		t.Subgroups = []domain.Subgroup{}
	}
	for i := range t.Subgroups {
		if t.Subgroups[i].Aliases == nil {
			t.Subgroups[i].Aliases = []string{}
		}
	}
}

func (s *Store) GetTeamBySlug(ctx context.Context, slug string) (*domain.Team, error) {
	var t domain.Team
	if err := s.c("teams").FindOne(ctx, bson.D{{Key: "slug", Value: slug}}).Decode(&t); err != nil {
		return nil, mapErr(err)
	}
	NormalizeTeam(&t)
	return &t, nil
}

func (s *Store) ListTeams(ctx context.Context) ([]domain.Team, error) {
	cur, err := s.c("teams").Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.Team
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i := range out {
		NormalizeTeam(&out[i])
	}
	return out, nil
}

// ---- memberships ----

func (s *Store) MembershipsByUser(ctx context.Context, userID bson.ObjectID) ([]domain.Membership, error) {
	return s.findMemberships(ctx, bson.D{{Key: "userId", Value: userID}})
}

func (s *Store) MembershipsByTeam(ctx context.Context, teamID bson.ObjectID) ([]domain.Membership, error) {
	return s.findMemberships(ctx, bson.D{{Key: "teamId", Value: teamID}})
}

func (s *Store) findMemberships(ctx context.Context, f bson.D) ([]domain.Membership, error) {
	cur, err := s.c("memberships").Find(ctx, f)
	if err != nil {
		return nil, err
	}
	var out []domain.Membership
	return out, cur.All(ctx, &out)
}

func (s *Store) GetMembership(ctx context.Context, teamID, userID bson.ObjectID) (*domain.Membership, error) {
	var m domain.Membership
	err := s.c("memberships").FindOne(ctx, bson.D{{Key: "teamId", Value: teamID}, {Key: "userId", Value: userID}}).Decode(&m)
	if err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}

func (s *Store) InsertMembership(ctx context.Context, m *domain.Membership) error {
	now := time.Now().UTC()
	m.CreatedAt, m.UpdatedAt, m.Version = now, now, 1
	res, err := s.c("memberships").InsertOne(ctx, m)
	if err != nil {
		return mapErr(err)
	}
	m.ID = res.InsertedID.(bson.ObjectID)
	return nil
}

// SetMembershipRoles overwrites the stored role sources of a membership.
// Unset (empty) roles are removed from the document.
func (s *Store) SetMembershipRoles(ctx context.Context, id bson.ObjectID, sso, manual domain.Role) error {
	set, unset := bson.D{{Key: "updatedAt", Value: time.Now().UTC()}}, bson.D{}
	for k, v := range map[string]domain.Role{"ssoRole": sso, "manualRole": manual} {
		if v == domain.RoleNone {
			unset = append(unset, bson.E{Key: k, Value: ""})
		} else {
			set = append(set, bson.E{Key: k, Value: v})
		}
	}
	upd := bson.D{{Key: "$set", Value: set}, {Key: "$inc", Value: bson.D{{Key: "version", Value: 1}}}}
	if len(unset) > 0 {
		upd = append(upd, bson.E{Key: "$unset", Value: unset})
	}
	_, err := s.c("memberships").UpdateOne(ctx, bson.D{{Key: "_id", Value: id}}, upd)
	return err
}

func (s *Store) DeleteMembership(ctx context.Context, id bson.ObjectID) error {
	_, err := s.c("memberships").DeleteOne(ctx, bson.D{{Key: "_id", Value: id}})
	return err
}

// ---- role mappings ----

func (s *Store) ListRoleMappings(ctx context.Context) ([]domain.RoleMapping, error) {
	cur, err := s.c("roleMappings").Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []domain.RoleMapping
	return out, cur.All(ctx, &out)
}

func (s *Store) GetRoleMapping(ctx context.Context, id string) (*domain.RoleMapping, error) {
	var m domain.RoleMapping
	if err := s.c("roleMappings").FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&m); err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}

// PutRoleMapping upserts a rule as-is (used for managed rules, whose version
// is computed by SyncManagedRoleMappings).
func (s *Store) PutRoleMapping(ctx context.Context, m domain.RoleMapping) error {
	_, err := s.c("roleMappings").ReplaceOne(ctx, bson.D{{Key: "_id", Value: m.ID}}, m, options.Replace().SetUpsert(true))
	return err
}

// InsertRoleMapping creates a UI-managed rule at version 1.
func (s *Store) InsertRoleMapping(ctx context.Context, m *domain.RoleMapping) error {
	m.Version = 1
	_, err := s.c("roleMappings").InsertOne(ctx, m)
	return mapErr(err)
}

// ReplaceRoleMapping replaces a rule if its version equals expected and bumps
// the version; otherwise ErrVersionConflict (or ErrNotFound).
func (s *Store) ReplaceRoleMapping(ctx context.Context, m domain.RoleMapping, expected int64) (*domain.RoleMapping, error) {
	m.Version = expected + 1
	res := s.c("roleMappings").FindOneAndReplace(ctx,
		bson.D{{Key: "_id", Value: m.ID}, {Key: "version", Value: expected}}, m,
		options.FindOneAndReplace().SetReturnDocument(options.After))
	var out domain.RoleMapping
	if err := res.Decode(&out); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			if n, cerr := s.c("roleMappings").CountDocuments(ctx, bson.D{{Key: "_id", Value: m.ID}}); cerr == nil && n > 0 {
				return nil, ErrVersionConflict
			}
			return nil, ErrNotFound
		}
		return nil, mapErr(err)
	}
	return &out, nil
}

// DeleteRoleMappingVersioned deletes a rule if its version equals expected.
func (s *Store) DeleteRoleMappingVersioned(ctx context.Context, id string, expected int64) error {
	res, err := s.c("roleMappings").DeleteOne(ctx, bson.D{{Key: "_id", Value: id}, {Key: "version", Value: expected}})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		if n, cerr := s.c("roleMappings").CountDocuments(ctx, bson.D{{Key: "_id", Value: id}}); cerr == nil && n > 0 {
			return ErrVersionConflict
		}
		return ErrNotFound
	}
	return nil
}

// SyncManagedRoleMappings upserts the given managed rules and deletes managed
// rules that are no longer present (spec §7.4). A rule's version is 1 when
// first loaded and increases whenever the file changes its content.
func (s *Store) SyncManagedRoleMappings(ctx context.Context, rules []domain.RoleMapping) error {
	ids := bson.A{}
	for _, r := range rules {
		r.Managed = true
		r.Version = 1
		if old, err := s.GetRoleMapping(ctx, r.ID); err == nil {
			r.Version = old.Version
			if !sameRuleContent(*old, r) {
				r.Version = old.Version + 1
			}
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		if err := s.PutRoleMapping(ctx, r); err != nil {
			return err
		}
		ids = append(ids, r.ID)
	}
	_, err := s.c("roleMappings").DeleteMany(ctx, bson.D{
		{Key: "managed", Value: true}, {Key: "_id", Value: bson.D{{Key: "$nin", Value: ids}}},
	})
	return err
}

func sameRuleContent(a, b domain.RoleMapping) bool {
	a.Version, b.Version = 0, 0
	return a == b
}
