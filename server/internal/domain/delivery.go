package domain

import (
	"strings"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// MatchState is the computed matching progress of a delivery line (spec §9.1).
type MatchState string

const (
	MatchUnmatched MatchState = "unmatched"
	MatchPartial   MatchState = "partial"
	MatchMatched   MatchState = "matched"
	MatchNotNeeded MatchState = "not_needed"
)

// Delivery is one box that arrived (spec §9.1).
type Delivery struct {
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Number     int           `bson:"number" json:"number"`
	ReceivedAt string        `bson:"receivedAt" json:"receivedAt"` // YYYY-MM-DD
	Source     string        `bson:"source" json:"source"`
	Note       string        `bson:"note" json:"note"`
	Voided     *Void         `bson:"voided" json:"voided"`
	CreatedBy  bson.ObjectID `bson:"createdBy" json:"createdBy"`
	CreatedAt  time.Time     `bson:"createdAt" json:"createdAt"`
	UpdatedAt  time.Time     `bson:"updatedAt" json:"updatedAt"`
	Version    int64         `bson:"version" json:"version"`
}

// NoMatch records that a delivery line needs no matching.
type NoMatch struct {
	Reason string        `bson:"reason" json:"reason"`
	By     bson.ObjectID `bson:"by" json:"by"`
	At     time.Time     `bson:"at" json:"at"`
}

// DeliveryLine is one line of what the box contained.
type DeliveryLine struct {
	ID              bson.ObjectID `bson:"_id,omitempty" json:"id"`
	DeliveryID      bson.ObjectID `bson:"deliveryId" json:"deliveryId"`
	LineNo          int           `bson:"lineNo" json:"lineNo"`
	Name            string        `bson:"name" json:"name"`
	SKU             string        `bson:"sku" json:"sku"`
	GoodQuantity    int           `bson:"goodQuantity" json:"goodQuantity"`
	ProblemQuantity int           `bson:"problemQuantity" json:"problemQuantity"`
	ProblemType     string        `bson:"problemType" json:"problemType"`
	ProblemNote     string        `bson:"problemNote" json:"problemNote"`
	NoMatch         *NoMatch      `bson:"noMatch" json:"noMatch"`
	MatchState      MatchState    `bson:"matchState" json:"matchState"`
	// DeliveryVoided is denormalised so the pending list can skip voided boxes.
	DeliveryVoided bool      `bson:"deliveryVoided" json:"-"`
	CreatedAt      time.Time `bson:"createdAt" json:"-"`
}

// DeriveMatchState computes a delivery line's matchState from its non-voided matches.
func DeriveMatchState(l *DeliveryLine, matches []DeliveryMatch) MatchState {
	if l.NoMatch != nil {
		return MatchNotNeeded
	}
	good, prob := 0, 0
	for _, m := range matches {
		if m.Voided == nil {
			good += m.GoodQuantity
			prob += m.ProblemQuantity
		}
	}
	switch {
	case good == l.GoodQuantity && prob == l.ProblemQuantity:
		return MatchMatched
	case good+prob == 0:
		return MatchUnmatched
	}
	return MatchPartial
}

// NameSimilarity is the Dice coefficient over character bigrams of two names,
// ignoring case, spaces and punctuation (0 to 1). It works for CJK text too.
func NameSimilarity(a, b string) float64 {
	ba, bb := bigrams(a), bigrams(b)
	if len(ba) == 0 || len(bb) == 0 {
		return 0
	}
	hit, total := 0, 0
	for k, n := range ba {
		total += n
		if m := bb[k]; m > 0 {
			hit += min(n, m)
		}
	}
	for _, n := range bb {
		total += n
	}
	return 2 * float64(hit) / float64(total)
}

func bigrams(s string) map[string]int {
	var rs []rune
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			rs = append(rs, r)
		}
	}
	out := map[string]int{}
	if len(rs) == 1 {
		out[string(rs)] = 1
	}
	for i := 0; i+1 < len(rs); i++ {
		out[string(rs[i:i+2])]++
	}
	return out
}
