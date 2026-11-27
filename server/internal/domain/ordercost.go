package domain

import (
	"fmt"
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
	LineID    string
	TeamID    string
	Quantity  int
	UnitPrice *decimal.Decimal // nil until priced
}

// ManualShare is one line's amount of a manual allocation (entry currency).
type ManualShare struct {
	LineID string
	Amount decimal.Decimal
}

// CostEntryInput is one non-voided cost entry as the calculation sees it.
// Entries are numbered 1.. in the order given (used in incomplete reasons).
type CostEntryInput struct {
	Settlement string // with_checkout | separate
	Currency   string
	Amount     decimal.Decimal
	// ActualBase is the real base-currency amount of a separate entry, if filled in.
	ActualBase *decimal.Decimal
	Mode       string // all | teams | lines | manual
	TeamIDs    []string
	LineIDs    []string
	Manual     []ManualShare
}

// OrderCostInput is everything the calculation needs about one non-cancelled order.
type OrderCostInput struct {
	Currency    string
	Base        string
	BaseDigits  int // minor-unit digits of the base currency
	Lines       []CostLine
	Entries     []CostEntryInput
	ChargedBase *decimal.Decimal
	// Rates are the reference rates (currency to Base) that exist; the order
	// currency and every separate entry currency are looked up here.
	Rates map[string]decimal.Decimal
}

// Why an order's amounts could not be computed (spec §11, "算不出來的情況").
const (
	IncompleteNoLines           = "no_lines"
	IncompleteMissingPrice      = "line_missing_price"
	IncompleteNoConversion      = "no_conversion"
	IncompleteOriginalTotalZero = "original_total_zero"
	// IncompleteEntryNoConversion: a separate entry has neither an actual base
	// amount nor a reference rate (EntryNo and Currency say which).
	IncompleteEntryNoConversion = "entry_no_conversion"
	// IncompleteAllocation: an entry's allocation matches no line, or its
	// manual amounts do not add up (EntryNo says which).
	IncompleteAllocation = "allocation_invalid"
)

// Incomplete names one reason; LineNo is set for line_missing_price, EntryNo
// (and Currency) for the entry reasons.
type Incomplete struct {
	Code     string `bson:"code" json:"code"`
	LineNo   int    `bson:"lineNo" json:"lineNo,omitempty"`
	EntryNo  int    `bson:"entryNo" json:"entryNo,omitempty"`
	Currency string `bson:"currency" json:"currency,omitempty"`
}

// LineCost is one line's computed amounts. Each value is nil when one of its
// own inputs is missing (see CalcOrderCost).
type LineCost struct {
	LineNo int
	// LineC is quantity x unit price in the order currency, exact and never rounded.
	LineC        *decimal.Decimal
	CostBase     *decimal.Decimal
	SharedBase   *decimal.Decimal // with-checkout costs
	SeparateBase *decimal.Decimal // separate payments and refunds
	TotalBase    *decimal.Decimal
	// CostProvisional: the conversion factor came from a reference rate.
	CostProvisional bool
	// SeparateProvisional: a separate entry allocated to the line uses a reference rate.
	SeparateProvisional bool
}

// EntryCost is the computed part of one cost entry, indexed like OrderCostInput.Entries.
type EntryCost struct {
	// AmountBase is E of a separate entry: its base-currency amount; nil for
	// with-checkout entries and when the entry's own data is not enough.
	AmountBase *decimal.Decimal
	// Provisional: E came from a reference rate.
	Provisional bool
}

// OrderCost is the result for one order.
type OrderCost struct {
	Lines     []LineCost
	Entries   []EntryCost
	LinesC    *decimal.Decimal // Σ lineC; nil when a line has no price
	CheckoutC *decimal.Decimal // nil when a line has no price
	OriginalC *decimal.Decimal // Σ lineC + checkoutC; nil when a line has no price
	F         *decimal.Decimal
	// FactorProvisional: F came from a reference rate.
	FactorProvisional bool
	// Provisional is true when a reference rate stands in for a real amount
	// (the factor, or any separate entry's E).
	Provisional  bool
	TargetBase   *decimal.Decimal
	SeparateBase *decimal.Decimal // Σ E
	NetBase      *decimal.Decimal
	// TeamTotals sums each team's line totals (base currency); nil when netBase is.
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
		if l.TotalBase == nil {
			return false
		}
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

// minorDecimal turns an amount in minor units into a decimal. digits is a
// currency's minor-unit digit count, which config and ISO 4217 keep in 0-4.
func minorDecimal(n *big.Int, digits int) decimal.Decimal {
	if digits < 0 || digits > 4 {
		panic(fmt.Sprintf("minorDecimal: minor-unit digits %d out of range 0-4", digits))
	}
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

// scope returns the indexes of the lines an entry is split over and, for
// manual entries, the exact share of each (in the entry's currency, as a
// fraction of 1 per line). ok is false when the allocation cannot be applied.
func scope(in OrderCostInput, e CostEntryInput) (idx []int, manual map[int]*big.Rat, ok bool) {
	switch e.Mode {
	case AllocTeams:
		set := map[string]bool{}
		for _, t := range e.TeamIDs {
			set[t] = true
		}
		for i, l := range in.Lines {
			if set[l.TeamID] {
				idx = append(idx, i)
			}
		}
	case AllocLines:
		set := map[string]bool{}
		for _, id := range e.LineIDs {
			set[id] = true
		}
		for i, l := range in.Lines {
			if set[l.LineID] {
				idx = append(idx, i)
			}
		}
	case AllocManual:
		byID := map[string]int{}
		for i, l := range in.Lines {
			byID[l.LineID] = i
		}
		manual = map[int]*big.Rat{}
		sum := decimal.Zero
		for _, m := range e.Manual {
			i, found := byID[m.LineID]
			if !found {
				return nil, nil, false
			}
			manual[i] = ratOf(m.Amount)
			sum = sum.Add(m.Amount)
		}
		if !sum.Equal(e.Amount) || e.Amount.IsZero() {
			return nil, nil, false
		}
		for i := range in.Lines {
			if _, has := manual[i]; has {
				idx = append(idx, i)
			}
		}
	default: // all
		for i := range in.Lines {
			idx = append(idx, i)
		}
	}
	return idx, manual, len(idx) > 0
}

// splitAmong splits total (exact) over the scoped lines: manual entries by
// their amounts scaled to total, others by weight (equal when the weights sum
// to 0). The result is indexed like lines; lines outside the scope get 0.
func splitAmong(n int, idx []int, manual map[int]*big.Rat, entryAmount, total *big.Rat, weight func(i int) *big.Rat) []*big.Rat {
	out := make([]*big.Rat, n)
	for i := range out {
		out[i] = new(big.Rat)
	}
	if manual != nil {
		for _, i := range idx {
			out[i] = new(big.Rat).Mul(total, new(big.Rat).Quo(manual[i], entryAmount))
		}
		return out
	}
	w := make([]*big.Rat, len(idx))
	for k, i := range idx {
		w[k] = weight(i)
	}
	for k, part := range allocate(total, w) {
		out[idx[k]] = part
	}
	return out
}

// CalcOrderCost implements spec §11 steps 1 to 9 for one order. Every value is
// null on its own as soon as one of its inputs is missing: a line's lineC needs
// only its unit price, the order-currency totals need every line priced, the
// factor and the line costs/shares need the totals and a conversion, and the
// separate amounts and netBase additionally need every separate entry's base
// amount E. Incomplete lists every missing input.
func CalcOrderCost(in OrderCostInput) OrderCost {
	n := len(in.Lines)
	res := OrderCost{Lines: make([]LineCost, n), Entries: make([]EntryCost, len(in.Entries))}
	for i, l := range in.Lines {
		res.Lines[i].LineNo = l.LineNo
	}
	if n == 0 {
		res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteNoLines})
	}
	// Step 1: line amounts (exact, never rounded).
	lineC := make([]*big.Rat, n)
	allPriced := n > 0
	for i, l := range in.Lines {
		if l.UnitPrice == nil {
			allPriced = false
			res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteMissingPrice, LineNo: l.LineNo})
			continue
		}
		d := l.UnitPrice.Mul(decimal.NewFromInt(int64(l.Quantity)))
		res.Lines[i].LineC = &d
		lineC[i] = ratOf(d)
	}
	// Step 2: with-checkout costs.
	checkoutC := decimal.Zero
	for _, e := range in.Entries {
		if e.Settlement == SettleWithCheckout {
			checkoutC = checkoutC.Add(e.Amount)
		}
	}

	// Resolve every entry's scope and, for separate entries, its base amount E.
	scale := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(in.BaseDigits)), nil))
	type resolved struct {
		idx    []int
		manual map[int]*big.Rat
		ok     bool     // the allocation matches the lines
		eMinor *big.Int // separate entries only; nil without E
	}
	rs := make([]resolved, len(in.Entries))
	checkoutScopesOK, separateReady := true, true
	for k, e := range in.Entries {
		idx, manual, ok := scope(in, e)
		rs[k] = resolved{idx: idx, manual: manual, ok: ok}
		if !ok {
			res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteAllocation, EntryNo: k + 1})
			if e.Settlement == SettleWithCheckout {
				checkoutScopesOK = false
			} else {
				separateReady = false
			}
		}
		if e.Settlement != SettleSeparate {
			continue
		}
		switch {
		case e.ActualBase != nil:
			rs[k].eMinor = roundHalfAwayRat(new(big.Rat).Mul(ratOf(*e.ActualBase), scale))
		case e.Currency == in.Base:
			rs[k].eMinor = roundHalfAwayRat(new(big.Rat).Mul(ratOf(e.Amount), scale))
		default:
			rate, has := in.Rates[e.Currency]
			if !has {
				res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteEntryNoConversion, EntryNo: k + 1, Currency: e.Currency})
				separateReady = false
				continue
			}
			rs[k].eMinor = roundHalfAwayRat(new(big.Rat).Mul(new(big.Rat).Mul(ratOf(e.Amount), ratOf(rate)), scale))
			res.Entries[k].Provisional = true
			res.Provisional = true
			if ok {
				for _, i := range idx {
					res.Lines[i].SeparateProvisional = true
				}
			}
		}
		if rs[k].eMinor != nil {
			d := minorDecimal(rs[k].eMinor, in.BaseDigits)
			res.Entries[k].AmountBase = &d
		}
	}
	if !allPriced {
		// The conversion is still checked so that Incomplete lists a missing rate too.
		if in.ChargedBase == nil && in.Currency != in.Base {
			if _, has := in.Rates[in.Currency]; !has {
				res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteNoConversion})
			}
		}
		return res
	}

	// Step 4: order-currency totals.
	sumLines := new(big.Rat)
	for _, r := range lineC {
		sumLines.Add(sumLines, r)
	}
	lc := ratToDecimal(sumLines)
	res.LinesC = &lc
	res.CheckoutC = &checkoutC
	originalRat := new(big.Rat).Add(sumLines, ratOf(checkoutC))
	original := ratToDecimal(originalRat)
	res.OriginalC = &original

	// Step 5: conversion factor.
	var f *big.Rat
	factorProvisional := false
	switch {
	case in.ChargedBase != nil && originalRat.Sign() != 0:
		f = new(big.Rat).Quo(ratOf(*in.ChargedBase), originalRat)
	case in.ChargedBase != nil && in.ChargedBase.IsZero():
		f = new(big.Rat) // everything is 0
	case in.ChargedBase != nil:
		res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteOriginalTotalZero})
	case in.Currency == in.Base:
		f = big.NewRat(1, 1)
	default:
		if rate, has := in.Rates[in.Currency]; has {
			f = ratOf(rate)
			factorProvisional = true
		} else {
			res.Incomplete = append(res.Incomplete, Incomplete{Code: IncompleteNoConversion})
		}
	}
	if f == nil || !checkoutScopesOK {
		return res
	}
	fDec := ratToDecimal(f)
	res.F = &fDec
	res.FactorProvisional = factorProvisional
	res.Provisional = res.Provisional || factorProvisional
	for i := range res.Lines {
		res.Lines[i].CostProvisional = factorProvisional
	}

	// Step 6: target total in minor units.
	var targetMinor *big.Int
	if in.ChargedBase != nil {
		targetMinor = roundHalfAwayRat(new(big.Rat).Mul(ratOf(*in.ChargedBase), scale))
	} else {
		targetMinor = roundHalfAwayRat(new(big.Rat).Mul(new(big.Rat).Mul(originalRat, f), scale))
	}
	target := minorDecimal(targetMinor, in.BaseDigits)
	res.TargetBase = &target

	// Step 3: with-checkout costs per line (order currency, exact).
	shared := make([]*big.Rat, n)
	for i := range shared {
		shared[i] = new(big.Rat)
	}
	for k, e := range in.Entries {
		if e.Settlement != SettleWithCheckout {
			continue
		}
		parts := splitAmong(n, rs[k].idx, rs[k].manual, ratOf(e.Amount), ratOf(e.Amount), func(i int) *big.Rat { return lineC[i] })
		for i := range shared {
			shared[i].Add(shared[i], parts[i])
		}
	}

	// Step 7: convert and round all cost/shared values together.
	vals := make([]*big.Rat, 0, 2*n)
	for i := 0; i < n; i++ {
		vals = append(vals, new(big.Rat).Mul(new(big.Rat).Mul(lineC[i], f), scale))
		vals = append(vals, new(big.Rat).Mul(new(big.Rat).Mul(shared[i], f), scale))
	}
	rounded := largestRemainder(vals, targetMinor)
	costMinor := make([]*big.Int, n)
	sharedMinor := make([]*big.Int, n)
	for i := 0; i < n; i++ {
		costMinor[i], sharedMinor[i] = rounded[2*i], rounded[2*i+1]
		c, s := minorDecimal(costMinor[i], in.BaseDigits), minorDecimal(sharedMinor[i], in.BaseDigits)
		res.Lines[i].CostBase, res.Lines[i].SharedBase = &c, &s
	}
	if !separateReady {
		return res
	}

	// Step 8: separate payments and refunds.
	sepMinor := make([]*big.Int, n)
	for i := range sepMinor {
		sepMinor[i] = new(big.Int)
	}
	eSum := new(big.Int)
	for k, e := range in.Entries {
		if e.Settlement != SettleSeparate {
			continue
		}
		eMinor := rs[k].eMinor
		eSum.Add(eSum, eMinor)
		weight := func(i int) *big.Rat { return new(big.Rat).SetInt(new(big.Int).Add(costMinor[i], sharedMinor[i])) }
		parts := splitAmong(n, rs[k].idx, rs[k].manual, ratOf(e.Amount), new(big.Rat).SetInt(eMinor), weight)
		for i, p := range largestRemainder(parts, eMinor) {
			sepMinor[i].Add(sepMinor[i], p)
		}
	}

	// Step 9: totals.
	res.TeamTotals = map[string]decimal.Decimal{}
	for i, l := range in.Lines {
		g := minorDecimal(sepMinor[i], in.BaseDigits)
		t := res.Lines[i].CostBase.Add(*res.Lines[i].SharedBase).Add(g)
		res.Lines[i].SeparateBase, res.Lines[i].TotalBase = &g, &t
		res.TeamTotals[l.TeamID] = res.TeamTotals[l.TeamID].Add(t)
	}
	sep := minorDecimal(eSum, in.BaseDigits)
	res.SeparateBase = &sep
	net := minorDecimal(new(big.Int).Add(targetMinor, eSum), in.BaseDigits)
	res.NetBase = &net
	return res
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
