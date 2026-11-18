package domain

import (
	"errors"
	"math/rand"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

func dd(s string) decimal.Decimal { return decimal.RequireFromString(s) }
func dp(s string) *decimal.Decimal {
	d := dd(s)
	return &d
}

func line(no int, team string, qty int, price string) CostLine {
	l := CostLine{LineNo: no, LineID: "l" + string(rune('0'+no)), TeamID: team, Quantity: qty}
	if price != "" {
		l.UnitPrice = dp(price)
	}
	return l
}

// checkout and separate build entries; mod adjusts the allocation or actual amount.
func checkout(amount string, mod func(*CostEntryInput)) CostEntryInput {
	e := CostEntryInput{Settlement: SettleWithCheckout, Amount: dd(amount), Mode: AllocAll}
	if mod != nil {
		mod(&e)
	}
	return e
}

func separate(cur, amount string, mod func(*CostEntryInput)) CostEntryInput {
	e := CostEntryInput{Settlement: SettleSeparate, Currency: cur, Amount: dd(amount), Mode: AllocAll}
	if mod != nil {
		mod(&e)
	}
	return e
}

func onTeams(ids ...string) func(*CostEntryInput) {
	return func(e *CostEntryInput) { e.Mode, e.TeamIDs = AllocTeams, ids }
}

func onLines(ids ...string) func(*CostEntryInput) {
	return func(e *CostEntryInput) { e.Mode, e.LineIDs = AllocLines, ids }
}

func str(d *decimal.Decimal) string {
	if d == nil {
		return "nil"
	}
	return d.StringFixed(2)
}

func TestCalcOrderCost(t *testing.T) {
	usd := func(lines []CostLine, mod func(*OrderCostInput)) OrderCostInput {
		in := OrderCostInput{Currency: "USD", Base: "USD", BaseDigits: 2, Lines: lines}
		if mod != nil {
			mod(&in)
		}
		return in
	}
	// A TWD base (no decimals) with USD orders, as in the refund cases.
	twd := func(lines []CostLine, mod func(*OrderCostInput)) OrderCostInput {
		in := OrderCostInput{Currency: "USD", Base: "TWD", BaseDigits: 0, Lines: lines,
			Rates: map[string]decimal.Decimal{"USD": dd("31")}}
		if mod != nil {
			mod(&in)
		}
		return in
	}
	tests := []struct {
		name       string
		in         OrderCostInput
		cost       []string // per line costBase
		shared     []string // per line sharedBase (with-checkout)
		sep        []string // per line separateBase (nil: not checked)
		total      []string // per line totalBase (nil: not checked)
		target     string
		net        string
		provision  bool
		incomplete []Incomplete
	}{
		{
			name: "ties go to the lower line, shared after cost",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10"), line(3, "a", 1, "10")},
				func(in *OrderCostInput) { in.Entries = []CostEntryInput{checkout("1", nil)} }),
			cost: []string{"10.00", "10.00", "10.00"}, shared: []string{"0.34", "0.33", "0.33"}, target: "31.00", net: "31.00",
		},
		{
			name: "actual charge scales every line; remainder goes to the largest fraction",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "20"), line(3, "a", 1, "30")},
				func(in *OrderCostInput) { in.Currency = "EUR"; in.ChargedBase = dp("100") }),
			cost: []string{"16.67", "33.33", "50.00"}, shared: []string{"0.00", "0.00", "0.00"}, target: "100.00", net: "100.00",
		},
		{
			name: "no charge, foreign currency with a reference rate is provisional",
			in: usd([]CostLine{line(1, "a", 2, "500")},
				func(in *OrderCostInput) {
					in.Currency = "TWD"
					in.Rates = map[string]decimal.Decimal{"TWD": dd("0.03")}
				}),
			cost: []string{"30.00"}, shared: []string{"0.00"}, target: "30.00", net: "30.00", provision: true,
		},
		{
			name:   "no charge and no rate cannot be converted",
			in:     usd([]CostLine{line(1, "a", 1, "5")}, func(in *OrderCostInput) { in.Currency = "TWD" }),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteNoConversion}},
		},
		{
			name:   "a missing price blocks everything and is named by line",
			in:     usd([]CostLine{line(1, "a", 1, "5"), line(2, "a", 1, "")}, nil),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteMissingPrice, LineNo: 2}},
		},
		{
			name:   "original total 0 with a charge is incomplete",
			in:     usd([]CostLine{line(1, "a", 1, "0")}, func(in *OrderCostInput) { in.Currency = "EUR"; in.ChargedBase = dp("12") }),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteOriginalTotalZero}},
		},
		{
			name: "original total 0 with a zero charge is all zeros",
			in:   usd([]CostLine{line(1, "a", 1, "0")}, func(in *OrderCostInput) { in.Currency = "EUR"; in.ChargedBase = dp("0") }),
			cost: []string{"0.00"}, shared: []string{"0.00"}, target: "0.00", net: "0.00",
		},
		{
			name: "a team-scoped coupon only lowers that team",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "30"), line(3, "b", 1, "20")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{checkout("6", nil), checkout("-10", onTeams("a"))}
			}),
			cost: []string{"10.00", "30.00", "20.00"}, shared: []string{"-1.50", "-4.50", "2.00"},
			total: []string{"8.50", "25.50", "22.00"}, target: "56.00", net: "56.00",
		},
		{
			name: "a discount larger than the fee still sums to the target",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{checkout("5", nil), checkout("-12.01", nil)}
			}),
			cost: []string{"10.00", "10.00"}, shared: []string{"-3.50", "-3.51"}, target: "12.99", net: "12.99",
		},
		{
			name: "zero base splits equally",
			in: usd([]CostLine{line(1, "a", 1, "0"), line(2, "a", 1, "0"), line(3, "a", 1, "0")},
				func(in *OrderCostInput) { in.Entries = []CostEntryInput{checkout("3", nil)} }),
			cost: []string{"0.00", "0.00", "0.00"}, shared: []string{"1.00", "1.00", "1.00"}, target: "3.00", net: "3.00",
		},
		{
			name: "USD order with TWD customs for one team: provisional by rate",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "b", 1, "20")}, func(in *OrderCostInput) {
				in.Rates = map[string]decimal.Decimal{"TWD": dd("0.03")}
				in.Entries = []CostEntryInput{separate("TWD", "300", onTeams("b"))}
			}),
			cost: []string{"10.00", "20.00"}, shared: []string{"0.00", "0.00"}, sep: []string{"0.00", "9.00"},
			total: []string{"10.00", "29.00"}, target: "30.00", net: "39.00", provision: true,
		},
		{
			name: "USD order with TWD customs for one team: actual amount is final",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "b", 1, "20")}, func(in *OrderCostInput) {
				in.Rates = map[string]decimal.Decimal{"TWD": dd("0.03")}
				in.Entries = []CostEntryInput{separate("TWD", "300", func(e *CostEntryInput) { onTeams("b")(e); e.ActualBase = dp("9.50") })}
			}),
			cost: []string{"10.00", "20.00"}, shared: []string{"0.00", "0.00"}, sep: []string{"0.00", "9.50"},
			total: []string{"10.00", "29.50"}, target: "30.00", net: "39.50",
		},
		{
			name: "USD refund to a line without an actual amount is provisional",
			in: twd([]CostLine{line(1, "a", 1, "50"), line(2, "b", 1, "50")}, func(in *OrderCostInput) {
				in.ChargedBase = dp("3200")
				in.Entries = []CostEntryInput{separate("USD", "-5", onLines("l2"))}
			}),
			cost: []string{"1600.00", "1600.00"}, shared: []string{"0.00", "0.00"}, sep: []string{"0.00", "-155.00"},
			total: []string{"1600.00", "1445.00"}, target: "3200.00", net: "3045.00", provision: true,
		},
		{
			name: "USD refund to a line with the actual amount is final",
			in: twd([]CostLine{line(1, "a", 1, "50"), line(2, "b", 1, "50")}, func(in *OrderCostInput) {
				in.ChargedBase = dp("3200")
				in.Entries = []CostEntryInput{separate("USD", "-5", func(e *CostEntryInput) { onLines("l2")(e); e.ActualBase = dp("-160") })}
			}),
			cost: []string{"1600.00", "1600.00"}, shared: []string{"0.00", "0.00"}, sep: []string{"0.00", "-160.00"},
			total: []string{"1600.00", "1440.00"}, target: "3200.00", net: "3040.00",
		},
		{
			name: "a separate entry without actual amount or rate makes the order incomplete",
			in: usd([]CostLine{line(1, "a", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{checkout("1", nil), separate("JPY", "1500", nil)}
			}),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteEntryNoConversion, EntryNo: 2, Currency: "JPY"}},
		},
		{
			name: "manual allocation: with-checkout by amounts, separate scaled to the real amount",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "b", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{
					checkout("10", func(e *CostEntryInput) {
						e.Mode, e.Manual = AllocManual, []ManualShare{{"l1", dd("3")}, {"l2", dd("7")}}
					}),
					separate("TWD", "100", func(e *CostEntryInput) {
						e.Mode, e.Manual = AllocManual, []ManualShare{{"l1", dd("40")}, {"l2", dd("60")}}
						e.ActualBase = dp("3")
					}),
				}
			}),
			cost: []string{"10.00", "10.00"}, shared: []string{"3.00", "7.00"}, sep: []string{"1.20", "1.80"},
			total: []string{"14.20", "18.80"}, target: "30.00", net: "33.00",
		},
		{
			name: "manual amounts that do not add up are named by entry",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "b", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{checkout("10", func(e *CostEntryInput) {
					e.Mode, e.Manual = AllocManual, []ManualShare{{"l1", dd("3")}, {"l2", dd("6")}}
				})}
			}),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteAllocation, EntryNo: 1}},
		},
		{
			name: "an allocation that matches no line is incomplete",
			in: usd([]CostLine{line(1, "a", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{checkout("1", onTeams("gone"))}
			}),
			target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteAllocation, EntryNo: 1}},
		},
		{
			name: "each separate entry rounds on its own: +0.01 to the first line, -0.01 to the last",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10"), line(3, "a", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{separate("USD", "0.01", nil), separate("USD", "-0.01", nil)}
			}),
			sep: []string{"0.01", "0.00", "-0.01"}, cost: []string{"10.00", "10.00", "10.00"}, shared: []string{"0.00", "0.00", "0.00"},
			target: "30.00", net: "30.00",
		},
		{
			name: "a lone negative separate cent lands on the last line",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10"), line(3, "a", 1, "10")}, func(in *OrderCostInput) {
				in.Entries = []CostEntryInput{separate("USD", "-0.01", nil)}
			}),
			sep: []string{"0.00", "0.00", "-0.01"}, cost: []string{"10.00", "10.00", "10.00"}, shared: []string{"0.00", "0.00", "0.00"},
			target: "30.00", net: "29.99",
		},
		{
			name: "zero-decimal base currency rounds half away from zero",
			in: OrderCostInput{Currency: "USD", Base: "JPY", BaseDigits: 0, Lines: []CostLine{line(1, "a", 1, "1")},
				Rates: map[string]decimal.Decimal{"USD": dd("149.5")}},
			cost: []string{"150.00"}, shared: []string{"0.00"}, target: "150.00", net: "150.00", provision: true,
		},
		{name: "an order without lines has no amounts", in: usd(nil, nil), target: "nil", net: "nil", incomplete: []Incomplete{{Code: IncompleteNoLines}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CalcOrderCost(tt.in)
			if str(got.TargetBase) != tt.target || str(got.NetBase) != tt.net || got.Provisional != tt.provision {
				t.Fatalf("target=%s net=%s provisional=%v, want %s %s %v", str(got.TargetBase), str(got.NetBase), got.Provisional, tt.target, tt.net, tt.provision)
			}
			if len(got.Incomplete) != len(tt.incomplete) {
				t.Fatalf("incomplete = %v, want %v", got.Incomplete, tt.incomplete)
			}
			for i, w := range tt.incomplete {
				if got.Incomplete[i] != w {
					t.Fatalf("incomplete[%d] = %v, want %v", i, got.Incomplete[i], w)
				}
			}
			check := func(field string, got []LineCost, pick func(LineCost) *decimal.Decimal, want []string) {
				for i := range want {
					if g := str(pick(got[i])); g != want[i] {
						t.Errorf("line %d %s = %s, want %s", i+1, field, g, want[i])
					}
				}
			}
			check("costBase", got.Lines, func(l LineCost) *decimal.Decimal { return l.CostBase }, tt.cost)
			check("sharedBase", got.Lines, func(l LineCost) *decimal.Decimal { return l.SharedBase }, tt.shared)
			check("separateBase", got.Lines, func(l LineCost) *decimal.Decimal { return l.SeparateBase }, tt.sep)
			check("totalBase", got.Lines, func(l LineCost) *decimal.Decimal { return l.TotalBase }, tt.total)
			if !got.InvariantHolds() {
				t.Errorf("netBase != Σ totalBase")
			}
			if got.NetBase != nil {
				sum := decimal.Zero
				for _, l := range got.Lines {
					sum = sum.Add(*l.CostBase).Add(*l.SharedBase)
				}
				if !sum.Equal(*got.TargetBase) {
					t.Errorf("Σ cost+shared = %s, target %s", sum, got.TargetBase)
				}
			}
		})
	}
}

// A team-scoped coupon leaves the other team's totals exactly as without it.
func TestScopedCouponLeavesOtherTeamAlone(t *testing.T) {
	base := OrderCostInput{Currency: "USD", Base: "USD", BaseDigits: 2,
		Lines:   []CostLine{line(1, "a", 1, "10"), line(2, "b", 1, "20")},
		Entries: []CostEntryInput{checkout("6", nil)}}
	with := base
	with.Entries = append([]CostEntryInput{}, base.Entries...)
	with.Entries = append(with.Entries, checkout("-4", onTeams("a")))
	b0, b1 := CalcOrderCost(base).TeamTotals["b"], CalcOrderCost(with).TeamTotals["b"]
	if !b0.Equal(b1) {
		t.Fatalf("team b total changed from %s to %s", b0, b1)
	}
}

// netBase = target + ΣE = Σ line totalBase for random orders, with every
// allocation mode, negative entries, zero prices and separate entries in
// several currencies (entries without a rate are skipped as incomplete).
func TestOrderCostInvariant(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	price := func() string { return decimal.New(rng.Int63n(2000), -int32(rng.Intn(3))).String() }
	alloc := func(in *OrderCostInput, e *CostEntryInput) {
		switch rng.Intn(4) {
		case 1:
			e.Mode, e.TeamIDs = AllocTeams, []string{[]string{"a", "b"}[rng.Intn(2)]}
		case 2:
			e.Mode, e.LineIDs = AllocLines, []string{in.Lines[rng.Intn(len(in.Lines))].LineID}
		case 3:
			e.Mode = AllocManual
			l := in.Lines[rng.Intn(len(in.Lines))]
			first := e.Amount.Div(decimal.NewFromInt(3)).Round(2)
			e.Manual = []ManualShare{{l.LineID, first}}
			rest := e.Amount.Sub(first)
			if other := in.Lines[l.LineNo%len(in.Lines)]; other.LineID != l.LineID {
				e.Manual = append(e.Manual, ManualShare{other.LineID, rest})
			} else {
				e.Manual[0].Amount = e.Amount
			}
		}
	}
	for n := 0; n < 500; n++ {
		in := OrderCostInput{Currency: "EUR", Base: "USD", BaseDigits: 2,
			Rates: map[string]decimal.Decimal{"EUR": dd("1.0837"), "TWD": dd("0.0312")}}
		for i := 1; i <= 1+rng.Intn(5); i++ {
			in.Lines = append(in.Lines, line(i, []string{"a", "b"}[rng.Intn(2)], 1+rng.Intn(4), price()))
		}
		for i := 0; i < rng.Intn(4); i++ {
			e := checkout(decimal.New(rng.Int63n(4000)-2000, -2).String(), nil)
			if e.Amount.IsZero() {
				continue
			}
			alloc(&in, &e)
			in.Entries = append(in.Entries, e)
		}
		for i := 0; i < rng.Intn(4); i++ {
			cur := []string{"USD", "TWD", "EUR"}[rng.Intn(3)]
			e := separate(cur, decimal.New(rng.Int63n(4000)-2000, -2).String(), nil)
			if e.Amount.IsZero() {
				continue
			}
			alloc(&in, &e)
			if rng.Intn(3) == 0 {
				a := e.Amount.Mul(dd("1.1")).Round(2)
				if !a.IsZero() {
					e.ActualBase = &a
				}
			}
			in.Entries = append(in.Entries, e)
		}
		if rng.Intn(2) == 0 {
			in.ChargedBase = dp(decimal.New(rng.Int63n(100000), -2).String())
		}
		got := CalcOrderCost(in)
		if !got.InvariantHolds() {
			t.Fatalf("invariant broken for %+v: %+v", in, got)
		}
		if got.NetBase == nil && len(got.Incomplete) == 0 {
			t.Fatalf("no amounts and no reason for %+v", in)
		}
		if got.NetBase != nil {
			e := decimal.Zero
			for _, l := range got.Lines {
				e = e.Add(*l.SeparateBase)
			}
			if !e.Equal(*got.SeparateBase) || !got.TargetBase.Add(e).Equal(*got.NetBase) {
				t.Fatalf("net %s != target %s + Σ separate %s", got.NetBase, got.TargetBase, e)
			}
		}
	}
}

func TestCostEntryValidate(t *testing.T) {
	entry := func(typ, settle, cur, amount string, mod func(*CostEntry)) CostEntry {
		e := CostEntry{Type: typ, Settlement: settle, Currency: cur, Amount: Decimal{dd(amount)}, Note: "n"}
		if mod != nil {
			mod(&e)
		}
		e.Normalize()
		return e
	}
	cash := func(e *CostEntry) { m := RefundCash; e.RefundMethod = &m }
	tests := []struct {
		name string
		e    CostEntry
		want string // substring of the error; "" = valid
	}{
		{"shipping with checkout", entry(CostShipping, SettleWithCheckout, "USD", "5", func(e *CostEntry) { e.Note = "" }), ""},
		{"discount must be negative", entry(CostDiscount, SettleWithCheckout, "USD", "5", nil), "negative"},
		{"coupon_used must be positive", entry(CostCouponUsed, SettleWithCheckout, "USD", "-5", nil), "positive"},
		{"with_checkout needs the order currency", entry(CostTax, SettleWithCheckout, "TWD", "5", nil), "order currency"},
		{"separate may use another currency", entry(CostTax, SettleSeparate, "TWD", "5", nil), ""},
		{"refund is always separate", entry(CostRefund, SettleWithCheckout, "USD", "-5", cash), "separate"},
		{"extra_charge is always separate", entry(CostExtra, SettleWithCheckout, "USD", "5", nil), "separate"},
		{"refund needs a method", entry(CostRefund, SettleSeparate, "USD", "-5", nil), "refundMethod"},
		{"refund with method", entry(CostRefund, SettleSeparate, "USD", "-5", cash), ""},
		{"method only for refunds", entry(CostFee, SettleSeparate, "USD", "5", cash), "only for refunds"},
		{"note required for other", entry(CostOther, SettleWithCheckout, "USD", "5", func(e *CostEntry) { e.Note = " " }), "note"},
		{"note required when not all", entry(CostFee, SettleWithCheckout, "USD", "5", func(e *CostEntry) {
			e.Note = ""
			e.Allocation = Allocation{Mode: AllocTeams, TeamIDs: nil}
		}), "mode teams"},
		{"actual amount sign must match", entry(CostTax, SettleSeparate, "TWD", "5", func(e *CostEntry) { e.ActualAmountBase = &Decimal{dd("-1")} }), "same sign"},
		{"actual amount only for separate", entry(CostTax, SettleWithCheckout, "USD", "5", func(e *CostEntry) { e.ActualAmountBase = &Decimal{dd("1")} }), "separate"},
		{"zero amount", entry(CostFee, SettleWithCheckout, "USD", "0", nil), "zero"},
	}
	for _, tt := range tests {
		err := tt.e.Validate("USD")
		switch {
		case tt.want == "" && err != nil:
			t.Errorf("%s: unexpected %v", tt.name, err)
		case tt.want != "" && (err == nil || !strings.Contains(err.Error(), tt.want)):
			t.Errorf("%s: error %v, want containing %q", tt.name, err, tt.want)
		}
	}
	// Manual allocation must add up; the failure is an AllocationError.
	e := entry(CostFee, SettleWithCheckout, "USD", "10", func(e *CostEntry) {
		e.Allocation = Allocation{Mode: AllocManual, Amounts: []ManualAmount{{Amount: Decimal{dd("4")}}}}
	})
	var allocErr *AllocationError
	if err := e.Validate("USD"); !errors.As(err, &allocErr) {
		t.Errorf("manual sum mismatch: %v", err)
	}
}

func TestCostSums(t *testing.T) {
	if c := SumPlaced(nil); c.Has || c.Value != nil || c.Incomplete {
		t.Errorf("no placed lines: %+v", c)
	}
	if c := SumPlaced([]*decimal.Decimal{dp("1.5"), dp("2")}); c.Value == nil || c.Value.String() != "3.5" {
		t.Errorf("sum: %+v", c)
	}
	if c := SumPlaced([]*decimal.Decimal{dp("1"), nil}); c.Value != nil || !c.Incomplete {
		t.Errorf("null propagates: %+v", c)
	}
	// Items without placed lines neither add nor null the batch cost.
	b := BatchCost([]CostSum{SumPlaced(nil), SumPlaced([]*decimal.Decimal{dp("4")})})
	if b.Value == nil || b.Value.String() != "4" {
		t.Errorf("batch: %+v", b)
	}
	if b := BatchCost([]CostSum{SumPlaced(nil)}); b.Has || b.Value != nil {
		t.Errorf("batch with no placed lines is null: %+v", b)
	}
}
