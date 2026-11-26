package domain

import "testing"

func TestNameKey(t *testing.T) {
	for _, c := range []struct{ a, b string }{
		{"  Hardware ", "hardware"},
		{"ΟΔΟΣ", "οδος"},      // final sigma folds like sigma
		{"ΟΔΟΣ", "οδοσ"},      // and so does the medial form
		{"Café", "café"},     // composed vs decomposed é (NFC)
		{"CAFÉ", "café"},     // and across case
		{"Straße", "STRASSE"}, // full case folding: ß folds to ss
	} {
		if ka, kb := NameKey(c.a), NameKey(c.b); ka != kb {
			t.Errorf("NameKey(%q) = %q, NameKey(%q) = %q; want equal", c.a, ka, c.b, kb)
		}
	}
	if NameKey("cafe") == NameKey("café") {
		t.Error("accents must not be dropped")
	}
}
