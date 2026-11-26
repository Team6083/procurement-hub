package service

import (
	"testing"

	"github.com/team6083/procurement-hub/server/internal/domain"
)

func TestMatchVendor(t *testing.T) {
	vendors := []domain.Vendor{
		{Name: "Digi-Key", NameKey: domain.NameKey("Digi-Key"), AliasKeys: []string{domain.NameKey("DK")}, Active: true},
		{Name: "Old", NameKey: domain.NameKey("Old"), AliasKeys: []string{domain.NameKey("legacy")}, Active: false},
	}
	for _, c := range []struct{ in, want string }{
		{"digi-key", "Digi-Key"}, {" dk ", "Digi-Key"}, {"legacy", ""}, {"Other shop", ""}, {"", ""},
	} {
		got := ""
		if v := matchVendor(vendors, c.in); v != nil {
			got = v.Name
		}
		if got != c.want {
			t.Errorf("matchVendor(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
