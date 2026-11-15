package domain

import (
	"sort"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// Cost calculation of spec §11. Everything here is a pure function of its
// input; the service layer loads the data and persists the result.

// costPrecision is the number of fractional digits kept in intermediate
// divisions. It is far beyond any currency's minor unit, so the only rounding
// that matters is the final largest-remainder step.
const costPrecision = 32

// LargestRemainder rounds each exact value to `digits` fractional digits so
// that the rounded values add up to exactly `total` (spec §11 step 7): every
// value is first rounded down, then the units that are still missing go to
// the values with the largest fractional remainders (ties: lower index
// first). `total` should be a multiple of the minor unit and the exact
// values should add up to it; if they do not, the result still sums to
// `total` rounded to the minor unit.
func LargestRemainder(exact []decimal.Decimal, total decimal.Decimal, digits int) []decimal.Decimal {
	n := len(exact)
	if n == 0 {
		return nil
	}
	scale := decimal.New(1, int32(digits))
	units := make([]decimal.Decimal, n)
	rems := make([]decimal.Decimal, n)
	sum := decimal.Zero
	for i, e := range exact {
		u := e.Mul(scale)
		f := u.Floor()
		units[i], rems[i] = f, u.Sub(f)
		sum = sum.Add(f)
	}
	need := total.Mul(scale).Round(0).Sub(sum).IntPart()
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return rems[order[a]].GreaterThan(rems[order[b]]) })
	one := decimal.NewFromInt(1)
	for k := int64(0); k < need; k++ {
		i := order[int(k%int64(n))]
		units[i] = units[i].Add(one)
	}
	for k := int64(0); k < -need; k++ {
		i := order[n-1-int(k%int64(n))]
		units[i] = units[i].Sub(one)
	}
	out := make([]decimal.Decimal, n)
	for i, u := range units {
		out[i] = u.Shift(int32(-digits))
	}
	return out
}

// ProportionalShares splits `total` over the weights in proportion to them,
// rounded to `digits` fractional digits with the shares adding up to
// `total`. When every weight is zero the total is split equally.
func ProportionalShares(total decimal.Decimal, weights []decimal.Decimal, digits int) []decimal.Decimal {
	n := len(weights)
	if n == 0 {
		return nil
	}
	sum := decimal.Zero
	for _, w := range weights {
		sum = sum.Add(w)
	}
	exact := make([]decimal.Decimal, n)
	for i, w := range weights {
		if sum.IsZero() {
			exact[i] = total.DivRound(decimal.NewFromInt(int64(n)), costPrecision)
		} else {
			exact[i] = total.Mul(w).DivRound(sum, costPrecision)
		}
	}
	return LargestRemainder(exact, total, digits)
}

// CostItem is one purchased item line. UnitPrice is the actual unit price in
// the vendor transaction's currency; nil while the bill has not been entered.
type CostItem struct {
	ID        bson.ObjectID
	Quantity  int // quantity bought
	UnitPrice *decimal.Decimal
}

// CostOrder is a team order within a vendor transaction.
type CostOrder struct {
	ID              bson.ObjectID
	Items           []CostItem
	AdjustmentsBase decimal.Decimal // Σ adjustments.amountBase
}

// CostInput is everything the cost calculation of one vendor transaction needs.
type CostInput struct {
	Currency     string // vendor transaction currency C
	Digits       int    // minor-unit digits of C
	BaseCurrency string
	BaseDigits   int
	Orders       []CostOrder
	SharedTotal  decimal.Decimal // Σ sharedCosts.amount, in C
	// ManualShares overrides the proportional allocation, in the order of
	// Orders; nil means proportional. They must add up to SharedTotal.
	ManualShares []decimal.Decimal
	// ChargedBase is chargedAmountBase when known.
	ChargedBase *decimal.Decimal
	// ReferenceRate is the first related team's rate for C, used only when
	// there is no charged amount and C is not the base currency.
	ReferenceRate *decimal.Decimal
}

// OrderCost is the computed cost of one order.
type OrderCost struct {
	OrderID         bson.ObjectID
	Share           decimal.Decimal // allocated shared costs, in C
	ItemsCostBase   decimal.Decimal
	SharedCostBase  decimal.Decimal
	AdjustmentsBase decimal.Decimal
	TotalBase       decimal.Decimal
}

// CostResult is the outcome of CalcCosts.
type CostResult struct {
	// Complete is false while base amounts cannot be computed: an item has
	// no actual price yet, or there is neither a charged amount nor a rate.
	// Then only the allocation and the adjustments are filled in.
	Complete bool
	// Provisional (spec's costsProvisional) is true unless the amounts are
	// exact: f came from a charged amount, or C is the base currency.
	Provisional   bool
	OriginalTotal decimal.Decimal
	Factor        decimal.Decimal // f, zero when not Complete
	Orders        []OrderCost
	ItemCostBase  map[bson.ObjectID]decimal.Decimal // actualCostBase per item, when Complete
}

// CalcCosts implements spec §11 steps 1-8 for one vendor transaction.
func CalcCosts(in CostInput) (CostResult, error) {
	n := len(in.Orders)
	res := CostResult{Orders: make([]OrderCost, n), ItemCostBase: map[bson.ObjectID]decimal.Decimal{}}

	// Step 1: item lines in C.
	complete := true
	lines := make([][]decimal.Decimal, n)
	subtotals := make([]decimal.Decimal, n)
	itemSum := decimal.Zero
	for oi, o := range in.Orders {
		lines[oi] = make([]decimal.Decimal, len(o.Items))
		for ii, it := range o.Items {
			if it.UnitPrice == nil {
				complete = false
				continue
			}
			l := it.UnitPrice.Mul(decimal.NewFromInt(int64(it.Quantity)))
			lines[oi][ii] = l
			subtotals[oi] = subtotals[oi].Add(l)
			itemSum = itemSum.Add(l)
		}
	}

	// Steps 2-3: allocation of the shared total.
	var shares []decimal.Decimal
	if in.ManualShares != nil {
		if len(in.ManualShares) != n {
			return res, errAllocationSize
		}
		sum := decimal.Zero
		for _, s := range in.ManualShares {
			sum = sum.Add(s)
		}
		if !sum.Equal(in.SharedTotal) {
			return res, ErrAllocationSum
		}
		shares = in.ManualShares
	} else {
		shares = ProportionalShares(in.SharedTotal, subtotals, in.Digits)
	}
	for oi, o := range in.Orders {
		res.Orders[oi] = OrderCost{OrderID: o.ID, Share: shares[oi], AdjustmentsBase: o.AdjustmentsBase, TotalBase: o.AdjustmentsBase}
	}
	res.Provisional = true
	if !complete {
		return res, nil
	}

	// Step 4-5: the conversion factor f.
	res.OriginalTotal = itemSum.Add(in.SharedTotal)
	// amounts[k] is the k-th amount in C: for each order its item lines, then its share.
	var amounts []decimal.Decimal
	for oi := range in.Orders {
		amounts = append(amounts, lines[oi]...)
		amounts = append(amounts, shares[oi])
	}
	var exact []decimal.Decimal
	var target decimal.Decimal
	switch {
	case in.ChargedBase != nil:
		charged := *in.ChargedBase
		if res.OriginalTotal.IsZero() {
			if !charged.IsZero() {
				return res, ErrCostBasisZero
			}
			res.Factor = decimal.NewFromInt(1)
			exact = amounts
		} else {
			res.Factor = charged.DivRound(res.OriginalTotal, costPrecision)
			exact = make([]decimal.Decimal, len(amounts))
			for i, a := range amounts {
				exact[i] = a.Mul(charged).DivRound(res.OriginalTotal, costPrecision)
			}
		}
		target = charged
		res.Provisional = false
	case in.Currency == in.BaseCurrency:
		res.Factor = decimal.NewFromInt(1)
		exact, target = amounts, res.OriginalTotal.Round(int32(in.BaseDigits))
		res.Provisional = false
	case in.ReferenceRate != nil:
		res.Factor = *in.ReferenceRate
		exact = make([]decimal.Decimal, len(amounts))
		for i, a := range amounts {
			exact[i] = a.Mul(res.Factor)
		}
		target = res.OriginalTotal.Mul(res.Factor).Round(int32(in.BaseDigits))
	default:
		return res, nil // no way to convert yet
	}
	res.Complete = true

	// Steps 6-7: convert and round so that everything adds up to the target.
	rounded := LargestRemainder(exact, target, in.BaseDigits)
	k := 0
	for oi, o := range in.Orders {
		oc := &res.Orders[oi]
		for _, it := range o.Items {
			res.ItemCostBase[it.ID] = rounded[k]
			oc.ItemsCostBase = oc.ItemsCostBase.Add(rounded[k])
			k++
		}
		oc.SharedCostBase = rounded[k]
		k++
		// Step 8.
		oc.TotalBase = oc.ItemsCostBase.Add(oc.SharedCostBase).Add(oc.AdjustmentsBase)
	}
	return res, nil
}

// EstimateLine is one item's estimate input: quantity × estimated unit price.
type EstimateLine struct {
	Quantity  int
	UnitPrice Money
}

// CurrencyTotal is an estimated total in one currency.
type CurrencyTotal struct {
	Currency string
	Total    decimal.Decimal
}

// Estimate is the reference-rate estimate of a set of items (spec §11):
// totals per currency plus a single base-currency total.
type Estimate struct {
	ByCurrency []CurrencyTotal // sorted by currency code
	// TotalBase converts every currency that has a rate (the base currency
	// needs none) and rounds half away from zero to the base minor unit.
	TotalBase decimal.Decimal
	// MissingRates lists currencies without a reference rate; they are left
	// out of TotalBase ("no rate" in the UI). Sorted.
	MissingRates []string
}

// EstimateTotals computes the estimate. rates maps currency → rateToBase.
func EstimateTotals(lines []EstimateLine, rates map[string]decimal.Decimal, baseCurrency string, baseDigits int) Estimate {
	totals := map[string]decimal.Decimal{}
	for _, l := range lines {
		totals[l.UnitPrice.Currency] = totals[l.UnitPrice.Currency].Add(l.UnitPrice.Amount.Mul(decimal.NewFromInt(int64(l.Quantity))))
	}
	var est Estimate
	for c := range totals {
		est.ByCurrency = append(est.ByCurrency, CurrencyTotal{Currency: c, Total: totals[c]})
	}
	sort.Slice(est.ByCurrency, func(i, j int) bool { return est.ByCurrency[i].Currency < est.ByCurrency[j].Currency })
	sum := decimal.Zero
	for _, ct := range est.ByCurrency {
		switch rate, ok := rates[ct.Currency]; {
		case ct.Currency == baseCurrency:
			sum = sum.Add(ct.Total)
		case ok:
			sum = sum.Add(ct.Total.Mul(rate))
		default:
			est.MissingRates = append(est.MissingRates, ct.Currency)
		}
	}
	est.TotalBase = sum.Round(int32(baseDigits))
	return est
}
