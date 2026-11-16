package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/team6083/procurement-hub/server/internal/authz"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// ProblemView is a delivery problem with where it came from.
type ProblemView struct {
	domain.LineProblem
	VendorOrderID     bson.ObjectID  `json:"vendorOrderId"`
	VendorOrderNumber int            `json:"vendorOrderNumber"`
	LineNo            int            `json:"lineNo"`
	LineName          string         `json:"lineName"`
	TeamID            bson.ObjectID  `json:"teamId"`
	DeliveryID        *bson.ObjectID `json:"deliveryId"`
	DeliveryNumber    *int           `json:"deliveryNumber"`
}

func (s *Deliveries) problemView(ctx context.Context, c *orderCache, p *domain.LineProblem) ProblemView {
	v := ProblemView{LineProblem: *p}
	if l := c.line(p.VendorOrderLineID); l != nil {
		v.VendorOrderID, v.LineNo, v.LineName, v.TeamID = l.VendorOrderID, l.LineNo, l.Name, l.TeamID
		if o := c.order(l.VendorOrderID); o != nil {
			v.VendorOrderNumber = o.Number
		}
	}
	if p.DeliveryMatchID != nil {
		var m domain.DeliveryMatch
		if err := s.st.DB.Collection("deliveryMatches").FindOne(ctx, bson.D{{Key: "_id", Value: *p.DeliveryMatchID}}).Decode(&m); err == nil {
			v.DeliveryID = &m.DeliveryID
			if d, err := s.st.GetDelivery(ctx, m.DeliveryID); err == nil {
				v.DeliveryNumber = &d.Number
			}
		}
	}
	return v
}

// Problems lists non-voided problems, newest first (capped at 500).
func (s *Deliveries) Problems(ctx context.Context, actor authz.Actor, status string, orderID bson.ObjectID) ([]ProblemView, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if status != "" && status != "open" && status != "resolved" {
		return nil, Invalid("status", "must be open or resolved")
	}
	var lineIDs []bson.ObjectID
	if !orderID.IsZero() {
		lines, err := s.st.LinesByOrder(ctx, orderID)
		if err != nil {
			return nil, err
		}
		for _, l := range lines {
			lineIDs = append(lineIDs, l.ID)
		}
	}
	ps, err := s.st.ListProblems(ctx, store.ProblemFilter{Status: status, VendorOrderID: orderID}, lineIDs, 500)
	if err != nil {
		return nil, err
	}
	c := s.cache(ctx)
	out := make([]ProblemView, 0, len(ps))
	for i := range ps {
		out = append(out, s.problemView(ctx, c, &ps[i]))
	}
	return out, nil
}

// ResolveInput is the body of POST /problems/{id}/resolve.
type ResolveInput struct {
	Action     string
	RefundBase string // positive; only with return_no_replace
	Note       string
}

// checkInequality verifies the §10.3 quantity inequality for a line as it
// would be with the given problem replaced (nil = unresolved copy of p).
func (s *Deliveries) checkInequality(ctx context.Context, l *domain.VendorOrderLine, replace *domain.LineProblem) error {
	ms, err := s.st.ActiveMatchesByLines(ctx, []bson.ObjectID{l.ID})
	if err != nil {
		return err
	}
	ps, err := s.st.ActiveProblemsByLines(ctx, []bson.ObjectID{l.ID})
	if err != nil {
		return err
	}
	var others []domain.LineProblem
	for _, p := range ps {
		if p.ID != replace.ID {
			others = append(others, p)
		}
	}
	q := domain.ComputeQuantities(ms, append(others, *replace))
	if used := q.Received + q.OpenProblem + q.Returned; used > l.Quantity {
		q0 := domain.ComputeQuantities(ms, others)
		return lineQuantityExceeded(l, l.Quantity-(q0.Received+q0.OpenProblem+q0.Returned))
	}
	return nil
}

// Resolve settles an open problem (purchasers).
func (s *Deliveries) Resolve(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, in ResolveInput) (*ProblemView, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	switch in.Action {
	case domain.ResolveExchange, domain.ResolveReturnNoReplace, domain.ResolveAccept:
	default:
		return nil, Invalid("action", "must be exchange, return_no_replace or accept")
	}
	if in.RefundBase != "" && in.Action != domain.ResolveReturnNoReplace {
		return nil, Invalid("refundBase", "only allowed with return_no_replace")
	}
	refund, err := s.batches.ParseRefund(in.RefundBase)
	if err != nil {
		return nil, err
	}
	var out *ProblemView
	err = s.tx(ctx, func(ctx context.Context) error {
		p, err := s.st.GetProblem(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		if p.Version != version {
			return ErrVersionConflict
		}
		if p.Voided != nil || p.Resolution != nil {
			return Rule("invalid_transition", "The problem is voided or already resolved.")
		}
		st := s.newState(ctx, actor, nil)
		l, o, err := s.loadLine(ctx, st, p.VendorOrderLineID)
		if err != nil {
			return err
		}
		if l.Closure != nil {
			return Rule("invalid_transition", "The line is closed; reopen it first.")
		}
		if err := s.st.BumpLine(ctx, l.ID); err != nil {
			return err
		}
		res := &domain.Resolution{Action: in.Action, Note: in.Note, By: actor.UserID, At: st.now}
		next := *p
		next.Resolution = res
		if err := s.checkInequality(ctx, l, &next); err != nil {
			return err
		}
		if refund != nil {
			e := &domain.LedgerEntry{VendorOrderID: o.ID, LineID: &l.ID, AmountBase: domain.Decimal{Decimal: *refund},
				Reason: "problem refund: " + p.Type, Source: domain.LedgerProblem, SourceID: &p.ID, CreatedBy: actor.UserID}
			if err := s.st.InsertLedger(ctx, e); err != nil {
				return err
			}
			res.RefundEntryID = &e.ID
		}
		if p, err = s.st.UpdateProblem(ctx, p.ID, p.Version, bson.D{{Key: "resolution", Value: res}}); err != nil {
			return mapStore(err)
		}
		st.touch(l)
		st.lineEvent(o, l, "vendor_order.problem_resolved", in.Note, ch("problem", "open", in.Action))
		st.problemEvent("problem.resolved", l, p, false)
		if err := s.finish(ctx, st); err != nil {
			return err
		}
		v := s.problemView(ctx, s.cache(ctx), p)
		out = &v
		return nil
	})
	return out, err
}

// Unresolve undoes a resolution; its refund entry is voided.
func (s *Deliveries) Unresolve(ctx context.Context, actor authz.Actor, id bson.ObjectID, version int64, reason string) (*ProblemView, error) {
	if err := s.gate(actor, false); err != nil {
		return nil, err
	}
	if !actor.IsPurchaser {
		return nil, ErrForbidden
	}
	reason, err := reasonOf(reason)
	if err != nil {
		return nil, err
	}
	var out *ProblemView
	err = s.tx(ctx, func(ctx context.Context) error {
		p, err := s.st.GetProblem(ctx, id)
		if err != nil {
			return mapStore(err)
		}
		if p.Version != version {
			return ErrVersionConflict
		}
		if p.Voided != nil || p.Resolution == nil {
			return Rule("invalid_transition", "The problem is voided or not resolved.")
		}
		st := s.newState(ctx, actor, nil)
		l, o, err := s.loadLine(ctx, st, p.VendorOrderLineID)
		if err != nil {
			return err
		}
		if l.Closure != nil {
			return &BlockedError{Blockers: []Blocker{{Type: "line_closure", ID: l.ID.Hex(), Label: lineSummaryLabel(l), ParentID: o.ID.Hex()}}}
		}
		if err := s.st.BumpLine(ctx, l.ID); err != nil {
			return err
		}
		prev := p.Resolution.Action
		next := *p
		next.Resolution = nil
		if err := s.checkInequality(ctx, l, &next); err != nil {
			return err
		}
		if e := p.Resolution.RefundEntryID; e != nil {
			if err := s.st.VoidLedger(ctx, *e, domain.Void{Reason: "resolution undone: " + reason, By: actor.UserID, At: st.now}); err != nil && err != store.ErrNotFound {
				return err
			}
		}
		if p, err = s.st.UpdateProblem(ctx, p.ID, p.Version, bson.D{{Key: "resolution", Value: nil}}); err != nil {
			return mapStore(err)
		}
		st.touch(l)
		st.lineEvent(o, l, "vendor_order.problem_resolved.undone", reason, ch("problem", prev, "open"))
		st.problemEvent("problem.resolved", l, p, true)
		if err := s.finish(ctx, st); err != nil {
			return err
		}
		v := s.problemView(ctx, s.cache(ctx), p)
		out = &v
		return nil
	})
	return out, err
}
