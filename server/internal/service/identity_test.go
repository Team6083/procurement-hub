package service

import (
	"testing"
	"time"
)

func TestIATCacheEvictsLRUAndKeepsNewest(t *testing.T) {
	c := newIATCache(2)
	t1, t2 := time.Unix(100, 0), time.Unix(200, 0)
	c.put("a", t1)
	c.put("b", t1)
	c.get("a") // a is now most recent
	c.put("c", t1)
	if _, ok := c.get("b"); ok {
		t.Fatal("b should have been evicted")
	}
	if _, ok := c.get("a"); !ok {
		t.Fatal("a should remain")
	}
	c.put("a", t2)
	c.put("a", t1) // older value must not regress the cache
	if got, _ := c.get("a"); !got.Equal(t2) {
		t.Fatalf("got %v want %v", got, t2)
	}
}
