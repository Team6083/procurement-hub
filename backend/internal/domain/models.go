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
	ID                 bson.ObjectID               `bson:"_id,omitempty" json:"id"`
	Sub                string                      `bson:"sub" json:"-"`
	Username           string                      `bson:"username" json:"username"`
	Email              string                      `bson:"email" json:"email"`
	DisplayName        string                      `bson:"displayName" json:"displayName"`
	Locale             Locale                      `bson:"locale" json:"locale"`
	NotificationPrefs  map[string]NotificationPref `bson:"notificationPrefs,omitempty" json:"notificationPrefs"`
	LastSyncedTokenIat time.Time                   `bson:"lastSyncedTokenIat" json:"-"`
	ExternalAccounts   map[string]any              `bson:"externalAccounts,omitempty" json:"-"` // Reserved
	CreatedAt          time.Time                   `bson:"createdAt" json:"createdAt"`
	UpdatedAt          time.Time                   `bson:"updatedAt" json:"updatedAt"`
	Version            int64                       `bson:"version" json:"version"`
}

type NotificationPref struct {
	Email bool `bson:"email" json:"email"`
}

type Subgroup struct {
	ID     string `bson:"id" json:"id"`
	Name   string `bson:"name" json:"name"`
	Active bool   `bson:"active" json:"active"`
}

type ReferenceRate struct {
	Currency   string    `bson:"currency" json:"currency"`
	RateToBase string    `bson:"rateToBase" json:"rateToBase"` // decimal string
	UpdatedAt  time.Time `bson:"updatedAt" json:"updatedAt"`
	UpdatedBy  string    `bson:"updatedBy" json:"updatedBy"`
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
	ReferenceRates []ReferenceRate   `bson:"referenceRates" json:"referenceRates"`
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
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id"`
	At         time.Time     `bson:"at" json:"at"`
	Actor      string        `bson:"actor" json:"actor"` // userId hex or "system:<job>"
	TeamID     bson.ObjectID `bson:"teamId,omitempty" json:"teamId,omitempty"`
	BatchID    bson.ObjectID `bson:"batchId,omitempty" json:"batchId,omitempty"` // set for batch and item events
	ObjectType string        `bson:"objectType" json:"objectType"`
	ObjectID   string        `bson:"objectId" json:"objectId"`
	Action     string        `bson:"action" json:"action"`
	Changes    []AuditChange `bson:"changes,omitempty" json:"changes"`
	Comment    string        `bson:"comment,omitempty" json:"comment,omitempty"`
}

// MarshalJSON omits unset ids: encoding/json cannot treat the ObjectID array
// type as empty, so `omitempty` alone would emit "000000000000000000000000".
func (e AuditEvent) MarshalJSON() ([]byte, error) {
	type plain AuditEvent // no methods, avoids recursion
	out := struct {
		plain
		TeamID  *bson.ObjectID `json:"teamId,omitempty"`
		BatchID *bson.ObjectID `json:"batchId,omitempty"`
	}{plain: plain(e)}
	if !e.TeamID.IsZero() {
		out.TeamID = &e.TeamID
	}
	if !e.BatchID.IsZero() {
		out.BatchID = &e.BatchID
	}
	return json.Marshal(out)
}
