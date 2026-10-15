package service

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
)

// removeAssignments strips a departed member from every batch assignment in the
// team and audits each affected batch (spec §8.1). Call it inside the same
// transaction that removes the membership.
func removeAssignments(ctx context.Context, st *store.Store, log *audit.Log, actor string, teamID, userID bson.ObjectID) error {
	batches, err := st.RemoveAssignee(ctx, teamID, userID)
	if err != nil || len(batches) == 0 {
		return err
	}
	evs := make([]domain.AuditEvent, 0, len(batches))
	for _, id := range batches {
		evs = append(evs, domain.AuditEvent{
			Actor: actor, TeamID: teamID, BatchID: id, ObjectType: "batch", ObjectID: id.Hex(),
			Action:  "batch.assignee_removed",
			Changes: []domain.AuditChange{{Field: "assignee", From: userID.Hex(), To: ""}},
			Comment: "member left the team",
		})
	}
	return log.Record(ctx, evs...)
}
