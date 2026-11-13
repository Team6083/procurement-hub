package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestAuditEventJSONOmitsZeroIDs(t *testing.T) {
	b, err := json.Marshal(AuditEvent{ID: bson.NewObjectID(), Actor: "u", ObjectType: "batch", ObjectID: "x", Action: "batch.created"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "teamId") || strings.Contains(string(b), "batchId") || strings.Contains(string(b), "000000000000000000000000") {
		t.Fatalf("zero ids leaked: %s", b)
	}
	id := bson.NewObjectID()
	b, _ = json.Marshal(AuditEvent{TeamID: id, BatchID: id, Action: "a"})
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	if out["teamId"] != id.Hex() || out["batchId"] != id.Hex() || out["action"] != "a" {
		t.Fatalf("set ids/fields wrong: %s", b)
	}
}
