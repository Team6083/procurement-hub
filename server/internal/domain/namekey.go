package domain

import (
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// NameKey normalises a vendor or subgroup name or alias for uniqueness checks: trimmed,
// Unicode case folded and NFC normalised, so "ΟΔΟΣ" and "οδος", or a composed and a
// decomposed "é", get the same key.
func NameKey(s string) string {
	return norm.NFC.String(cases.Fold().String(norm.NFD.String(strings.TrimSpace(s))))
}
