package domain

import (
	"encoding/json"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type Visibility string

const (
	VisibilityPublic  Visibility = "public"
	VisibilityMembers Visibility = "members"
)

func (v Visibility) Valid() bool { return v == VisibilityPublic || v == VisibilityMembers }

type Locale string

const (
	LocaleEN   Locale = "en"
	LocaleZHTW Locale = "zh-TW"
)

func (l Locale) Valid() bool { return l == LocaleEN || l == LocaleZHTW }

type User struct {
	ID          bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Sub         string        `bson:"sub" json:"-"`
	Username    string        `bson:"username" json:"username"`
	Email       string        `bson:"email" json:"email"`
	DisplayName string        `bson:"displayName" json:"displayName"`
	// Locale is nil until the user chooses one (spec §0): clients then follow
	// the browser language; server-side rendering (notifications) must fall
	// back to the team locale or en.
	Locale            *Locale                     `bson:"locale,omitempty" json:"locale"`
	NotificationPrefs map[string]NotificationPref `bson:"notificationPrefs,omitempty" json:"notificationPrefs"`
	// RoleSnapshot is refreshed on role-mapping sync; notification targets and
	// assignment candidates only, never authorization (spec §7.3).
	RoleSnapshot       RoleSnapshot   `bson:"roleSnapshot" json:"-"`
	LastSyncedTokenIat time.Time      `bson:"lastSyncedTokenIat" json:"-"`
	ExternalAccounts   map[string]any `bson:"externalAccounts,omitempty" json:"-"` // Reserved
	CreatedAt          time.Time      `bson:"createdAt" json:"createdAt"`
	UpdatedAt          time.Time      `bson:"updatedAt" json:"updatedAt"`
	Version            int64          `bson:"version" json:"version"`
}

type RoleSnapshot struct {
	Purchaser bool      `bson:"purchaser" json:"purchaser"`
	Receiver  bool      `bson:"receiver" json:"receiver"`
	At        time.Time `bson:"at" json:"at"`
}

type NotificationPref struct {
	Email bool `bson:"email" json:"email"`
}

type Subgroup struct {
	ID     string `bson:"id" json:"id"`
	Name   string `bson:"name" json:"name"`
	Active bool   `bson:"active" json:"active"`
}

type Team struct {
	ID             bson.ObjectID     `bson:"_id,omitempty" json:"id"`
	Slug           string            `bson:"slug" json:"slug"`
	Name           string            `bson:"name" json:"name"`
	Description    string            `bson:"description" json:"description"`
	Visibility     Visibility        `bson:"visibility" json:"visibility"`
	Locale         Locale            `bson:"locale" json:"locale"`
	PriorityLabels map[string]string `bson:"priorityLabels,omitempty" json:"priorityLabels"`
	Subgroups      []Subgroup        `bson:"subgroups" json:"subgroups"`
	Budget         map[string]any    `bson:"budget,omitempty" json:"-"` // Reserved
	Archived       bool              `bson:"archived" json:"archived"`
	BatchCounter   int               `bson:"batchCounter" json:"-"`
	CreatedAt      time.Time         `bson:"createdAt" json:"createdAt"`
	UpdatedAt      time.Time         `bson:"updatedAt" json:"updatedAt"`
	Version        int64             `bson:"version" json:"version"`
}

type Membership struct {
	ID                bson.ObjectID `bson:"_id,omitempty" json:"id"`
	TeamID            bson.ObjectID `bson:"teamId" json:"teamId"`
	UserID            bson.ObjectID `bson:"userId" json:"userId"`
	SSORole           Role          `bson:"ssoRole,omitempty" json:"ssoRole"`
	ManualRole        Role          `bson:"manualRole,omitempty" json:"manualRole"`
	DefaultSubgroupID string        `bson:"defaultSubgroupId,omitempty" json:"defaultSubgroupId"`
	CreatedAt         time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt         time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version           int64         `bson:"version" json:"version"`
}

func (m Membership) Effective() Role { return EffectiveRole(m.SSORole, m.ManualRole) }

// AuditChange is one field-level change in an audit event.
type AuditChange struct {
	Field string `bson:"field" json:"field"`
	From  any    `bson:"from" json:"from"`
	To    any    `bson:"to" json:"to"`
}

// AuditEvent is an append-only record (spec §9.1).
type AuditEvent struct {
	ID bson.ObjectID `bson:"_id,omitempty" json:"id"`
	At time.Time     `bson:"at" json:"at"`
	// Actor is a userId hex or "system:<job>".
	Actor string `bson:"actor" json:"actor"`
	// TeamIDs are the teams involved; vendor order and delivery events may have several.
	TeamIDs    []bson.ObjectID `bson:"teamIds,omitempty" json:"teamIds"`
	BatchID    bson.ObjectID   `bson:"batchId,omitempty" json:"batchId,omitempty"` // set for batch, item and linked-line events
	ObjectType string          `bson:"objectType" json:"objectType"`
	ObjectID   string          `bson:"objectId" json:"objectId"`
	Action     string          `bson:"action" json:"action"`
	Changes    []AuditChange   `bson:"changes,omitempty" json:"changes"`
	Comment    string          `bson:"comment,omitempty" json:"comment,omitempty"`
	// Scope is "line" for events about one vendor order line (visible per line)
	// and "order" for order-level events (summarised for regular users, §8.2).
	Scope string `bson:"scope,omitempty" json:"-"`
	// LineIDs names the order lines a "line" scope event is about.
	LineIDs []string `bson:"lineIds,omitempty" json:"-"`
}

// MarshalJSON omits an unset batch id: encoding/json cannot treat the ObjectID
// array type as empty, so `omitempty` alone would emit "000000000000000000000000".
func (e AuditEvent) MarshalJSON() ([]byte, error) {
	type plain AuditEvent // no methods, avoids recursion
	out := struct {
		plain
		TeamIDs []bson.ObjectID `json:"teamIds"`
		BatchID *bson.ObjectID  `json:"batchId,omitempty"`
	}{plain: plain(e), TeamIDs: e.TeamIDs}
	if out.TeamIDs == nil {
		out.TeamIDs = []bson.ObjectID{}
	}
	if !e.BatchID.IsZero() {
		out.BatchID = &e.BatchID
	}
	return json.Marshal(out)
}
