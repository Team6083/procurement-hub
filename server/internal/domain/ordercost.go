package domain

import (
	"math/big"
	"sort"

	"github.com/shopspring/decimal"
)

// Vendor order cost calculation of spec §11. Everything here is a pure
// function; amounts are computed exactly (big.Rat) and rounded once, with the
// largest remainder method, to the base currency's minor unit.

// CostLine is one vendor order line as the calculation sees it. Lines must be
// given in lineNo order; LineNo is the 1-based position used for tie-breaks.
type CostLine struct {
	LineNo    int
	TeamID    string
	Quantity  int
	UnitPrice *decimal.Decimal // nil until priced
}

// TeamOverride is a team's fixed share of the shared costs (order currency).
type TeamOverride struct {
	TeamID string
	Amount decimal.Decimal
}

// LedgerAmount is one non-voided ledger entry in the base currency (refunds
// are negative). LineNo 0 means the entry is not tied to a line.
type LedgerAmount struct {
	AmountBase decimal.Decimal
	LineNo     int
}

// OrderCostInput is everything the calculation needs about one non-cancelled order.
type OrderCostInput struct {
	Currency   string
	Base       string
	BaseDigits int // minor-unit digits of the base currency
	Lines      []CostLine
	// SharedCosts are the amounts of the shared cost items; discounts are negative.
	SharedCosts   []decimal.Decimal
	TeamOverrides []TeamOverride
	ChargedBase   *decimal.Decimal
	// Rate is the reference rate of Currency to Base (nil when none is set).
	Rate   *decimal.Decimal
	Ledger []LedgerAmount
}

// Why an order's amounts could not be computed (spec §11, "算不出來的情況").
const (
	IncompleteNoLines           = "no_lines"
	IncompleteMissingPrice      = "line_missing_price"
	IncompleteNoConversion      = "no_conversion"
	IncompleteOriginalTotalZero = "original_total_zero"
)

// Incomplete names one reason; LineNo is set for line_missing_price.
type Incomplete struct {
	Code   string `json:"code"`
	LineNo int    `json:"lineNo,omitempty"`
}

// LineCost is one line's computed amounts. Base-currency fields are nil when
// the order is incomplete.
type LineCost struct {
	LineNo     int
	LineC      *decimal.Decimal
	CostBase   *decimal.Decimal
	SharedBase *decimal.Decimal
	LedgerBase *decimal.Decimal
	TotalBase  *decimal.Decimal
}

// OrderCost is the result for one order.
type OrderCost struct {
	Lines       []LineCost
	OriginalC   *decimal.Decimal // Σ lineC + sharedC; nil when a line has no price
	SharedC     decimal.Decimal
	F           *decimal.Decimal
	Provisional bool
	TargetBase  *decimal.Decimal
	NetBase     *decimal.Decimal
	// TeamTotals sums each team's line totals (base currency); nil when incomplete.
	TeamTotals map[string]decimal.Decimal
	Incomplete []Incomplete
}

// InvariantHolds reports netBase == Σ line totalBase (spec §11 step 9); true
// for incomplete orders, which have no amounts.
func (c OrderCost) InvariantHolds() bool {
	if c.NetBase == nil {
		return true
	}
	sum := decimal.Zero
	for _, l := range c.Lines {
		sum = sum.Add(*l.TotalBase)
	}
	return sum.Equal(*c.NetBase)
}

func ratOf(d decimal.Decimal) *big.Rat {
	r := new(big.Rat).SetInt(d.Coefficient())
	e := d.Exponent()
	pow := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(abs32(e))), nil)
	if e >= 0 {
		return r.Mul(r, new(big.Rat).SetInt(pow))
	}
	return r.Quo(r, new(big.Rat).SetInt(pow))
}

func abs32(x int32) int32 {
	if x < 0 {
		return -x
	}
	return x
}

func minorDecimal(n *big.Int, digits int) decimal.Decimal {
	return decimal.NewFromBigInt(n, -int32(digits))
}

// roundHalfAwayRat rounds a rational to an integer, half away from zero.
func roundHalfAwayRat(r *big.Rat) *big.Int {
	num, den := new(big.Int).Set(r.Num()), r.Denom()
	neg := num.Sign() < 0
	num.Abs(num)
	twice := new(big.Int).Lsh(num, 1)
	twice.Add(twice, den)
	q := new(big.Int).Quo(twice, new(big.Int).Lsh(den, 1)) // floor((2n+d) / 2d)
	if neg {
		q.Neg(q)
	}
	return q
}

func floorRat(r *big.Rat) *big.Int {
	q := new(big.Int)
	m := new(big.Int)
	q.DivMod(r.Num(), r.Denom(), m) // Euclidean: floor for a positive denominator
	return q
}

// largestRemainder rounds exact values (already in minor units) to integers
// whose sum is target: every value is floored toward negative infinity, then
// the remaining units go one by one to the largest fractional parts; ties by
// index (callers order values by lineNo, costBase before sharedBase).
func largestRemainder(values []*big.Rat, target *big.Int) []*big.Int {
	n := len(values)
	out := make([]*big.Int, n)
	fracs := make([]*big.Rat, n)
	sum := new(big.Int)
	for i, v := range values {
		out[i] = floorRat(v)
		fracs[i] = new(big.Rat).Sub(v, new(big.Rat).SetInt(out[i]))
		sum.Add(sum, out[i])
	}
	if n == 0 {
		return out
	}
	rest := new(big.Int).Sub(target, sum)
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return fracs[idx[a]].Cmp(fracs[idx[b]]) > 0 })
	step := big.NewInt(1)
	if rest.Sign() < 0 {
		step = big.NewInt(-1) // only if the exact values sum above the target
		sort.SliceStable(idx, func(a, b int) bool { return fracs[idx[a]].Cmp(fracs[idx[b]]) < 0 })
	}
	for k := 0; rest.Sign() != 0; k = (k + 1) % n {
		out[idx[k]].Add(out[idx[k]], step)
		rest.Sub(rest, step)
	}
	return out
}

// allocate splits total over the weights proportionally (exactly); an all-zero
// weight sum splits equally.
func allocate(total *big.Rat, weights []*big.Rat) []*big.Rat {
	n := len(weights)
	out := make([]*big.Rat, n)
	sum := new(big.Rat)
	for _, w := range weights {
		sum.Add(sum, w)
	}
	for i, w := range weights {
		if sum.Sign() == 0 {
			out[i] = new(big.Rat).Quo(total, big.NewRat(int64(n), 1))
		} else {
			out[i] = new(big.Rat).Mul(total, new(big.Rat).Quo(w, sum))
		}
	}
	return out
}

// CalcOrderCost implements spec §11 steps 1 to 9 for one order.
func CalcOrderCost(in OrderCostInput) OrderCost {
	res := OrderCost{Lines: make([]LineCost, len(in.Lines))}
	for i, l := range in.Lines {
		res.Lines[i].LineNo = l.LineNo
	}
	if len(in.Lines) == 0 {
		res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteNoLines})
		return res
	}
	// Step 1: line amounts.
	lineC := make([]*big.Rat, len(in.Lines))
	missing := false
	for i, l := range in.Lines {
		if l.UnitPrice == nil {
			missing = true
			res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteMissingPrice, LineNo: l.LineNo})
			continue
		}
		d := l.UnitPrice.Mul(decimal.NewFromInt(int64(l.Quantity)))
		res.Lines[i].LineC = &d
		lineC[i] = ratOf(d)
	}
	// Step 2: shared costs.
	sharedC := decimal.Zero
	for _, s := range in.SharedCosts {
		sharedC = sharedC.Add(s)
	}
	res.SharedC = sharedC
	if missing {
		return res
	}
	// Step 4.
	sumLines := new(big.Rat)
	for _, r := range lineC {
		sumLines.Add(sumLines, r)
	}
	sharedRat := ratOf(sharedC)
	originalRat := new(big.Rat).Add(sumLines, sharedRat)
	original := ratToDecimal(originalRat)
	res.OriginalC = &original

	// Step 5: conversion factor.
	var f *big.Rat
	switch {
	case in.ChargedBase != nil && originalRat.Sign() != 0:
		f = new(big.Rat).Quo(ratOf(*in.ChargedBase), originalRat)
	case in.ChargedBase != nil && in.ChargedBase.IsZero():
		f = new(big.Rat) // everything is 0
	case in.ChargedBase != nil:
		res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteOriginalTotalZero})
		return res
	case in.Currency == in.Base:
		f = big.NewRat(1, 1)
	case in.Rate != nil:
		f = ratOf(*in.Rate)
		res.Provisional = true
	default:
		res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteNoConversion})
		return res
	}
	fDec := ratToDecimal(f)
	res.F = &fDec

	scale := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(in.BaseDigits)), nil))
	// Step 6: target total in minor units.
	var targetMinor *big.Int
	if in.ChargedBase != nil {
		targetMinor = roundHalfAwayRat(new(big.Rat).Mul(ratOf(*in.ChargedBase), scale))
	} else {
		targetMinor = roundHalfAwayRat(new(big.Rat).Mul(new(big.Rat).Mul(originalRat, f), scale))
	}
	target := minorDecimal(targetMinor, in.BaseDigits)
	res.TargetBase = &target

	// Step 3: shared costs per line (order currency, exact).
	shared := allocateShared(in, lineC, sharedRat)

	// Step 7: convert and round all cost/shared values together.
	vals := make([]*big.Rat, 0, 2*len(in.Lines))
	for i := range in.Lines {
		vals = append(vals, new(big.Rat).Mul(new(big.Rat).Mul(lineC[i], f), scale))
		vals = append(vals, new(big.Rat).Mul(new(big.Rat).Mul(shared[i], f), scale))
	}
	rounded := largestRemainder(vals, targetMinor)
	costMinor := make([]*big.Int, len(in.Lines))
	sharedMinor := make([]*big.Int, len(in.Lines))
	for i := range in.Lines {
		costMinor[i], sharedMinor[i] = rounded[2*i], rounded[2*i+1]
	}

	// Step 8: ledger per line.
	ledgerMinor := make([]*big.Int, len(in.Lines))
	for i := range ledgerMinor {
		ledgerMinor[i] = new(big.Int)
	}
	ledgerSum := new(big.Int)
	lineIdx := map[int]int{}
	for i, l := range in.Lines {
		lineIdx[l.LineNo] = i
	}
	for _, e := range in.Ledger {
		amt := roundHalfAwayRat(new(big.Rat).Mul(ratOf(e.AmountBase), scale))
		ledgerSum.Add(ledgerSum, amt)
		if i, ok := lineIdx[e.LineNo]; ok && e.LineNo != 0 {
			ledgerMinor[i].Add(ledgerMinor[i], amt)
			continue
		}
		weights := make([]*big.Rat, len(in.Lines))
		for i := range in.Lines {
			weights[i] = new(big.Rat).SetInt(new(big.Int).Add(costMinor[i], sharedMinor[i]))
		}
		parts := largestRemainder(allocate(new(big.Rat).SetInt(amt), weights), amt)
		for i, p := range parts {
			ledgerMinor[i].Add(ledgerMinor[i], p)
		}
	}

	// Step 9: totals.
	res.TeamTotals = map[string]decimal.Decimal{}
	for i, l := range in.Lines {
		c, s, g := minorDecimal(costMinor[i], in.BaseDigits), minorDecimal(sharedMinor[i], in.BaseDigits), minorDecimal(ledgerMinor[i], in.BaseDigits)
		t := c.Add(s).Add(g)
		res.Lines[i].CostBase, res.Lines[i].SharedBase, res.Lines[i].LedgerBase, res.Lines[i].TotalBase = &c, &s, &g, &t
		res.TeamTotals[l.TeamID] = res.TeamTotals[l.TeamID].Add(t)
	}
	net := minorDecimal(new(big.Int).Add(targetMinor, ledgerSum), in.BaseDigits)
	res.NetBase = &net
	return res
}

// allocateShared implements step 3: by lineC proportion, or team overrides
// first and then lineC within each team; equal split on a zero base.
func allocateShared(in OrderCostInput, lineC []*big.Rat, sharedRat *big.Rat) []*big.Rat {
	n := len(in.Lines)
	if len(in.TeamOverrides) == 0 {
		return allocate(sharedRat, lineC)
	}
	out := make([]*big.Rat, n)
	byTeam := map[string][]int{}
	for i, l := range in.Lines {
		byTeam[l.TeamID] = append(byTeam[l.TeamID], i)
	}
	for _, o := range in.TeamOverrides {
		idx := byTeam[o.TeamID]
		weights := make([]*big.Rat, len(idx))
		for k, i := range idx {
			weights[k] = lineC[i]
		}
		for k, part := range allocate(ratOf(o.Amount), weights) {
			out[idx[k]] = part
		}
	}
	for i := range out {
		if out[i] == nil {
			out[i] = new(big.Rat) // a team without an override share gets none
		}
	}
	return out
}

// ratToDecimal converts an exact rational to a decimal for display (16 digits).
func ratToDecimal(r *big.Rat) decimal.Decimal {
	return decimal.NewFromBigInt(r.Num(), 0).DivRound(decimal.NewFromBigInt(r.Denom(), 0), 16).Truncate(16).Round(16)
}

// CostSum is a cost aggregate over placed lines (items, batches, teams).
type CostSum struct {
	Value *decimal.Decimal
	// Has is false when there were no placed lines at all.
	Has bool
	// Incomplete is true when some line's cost could not be computed.
	Incomplete bool
}

// SumPlaced adds placed lines' totalBase values (nil = not computable).
func SumPlaced(totals []*decimal.Decimal) CostSum {
	c := CostSum{Has: len(totals) > 0}
	sum := decimal.Zero
	for _, t := range totals {
		if t == nil {
			c.Incomplete = true
			continue
		}
		sum = sum.Add(*t)
	}
	if c.Has && !c.Incomplete {
		c.Value = &sum
	}
	return c
}

// BatchCost sums item costs; only items with placed lines count, so items
// without any neither add to the total nor make it null (spec §11 step 9).
func BatchCost(items []CostSum) CostSum {
	var vals []*decimal.Decimal
	for _, it := range items {
		if !it.Has {
			continue
		}
		vals = append(vals, it.Value)
	}
	return SumPlaced(vals)
}
