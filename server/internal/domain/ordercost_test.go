package domain

import (
	"math/rand"
	"testing"

	"github.com/shopspring/decimal"
)

func dd(s string) decimal.Decimal { return decimal.RequireFromString(s) }
func dp(s string) *decimal.Decimal {
	d := dd(s)
	return &d
}

func line(no int, team string, qty int, price string) CostLine {
	l := CostLine{LineNo: no, TeamID: team, Quantity: qty}
	if price != "" {
		l.UnitPrice = dp(price)
	}
	return l
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
	tests := []struct {
		name       string
		in         OrderCostInput
		cost       []string // per line costBase
		shared     []string // per line sharedBase
		ledger     []string // per line ledgerBase (nil: not checked)
		target     string
		net        string
		provision  bool
		incomplete []Incomplete
	}{
		{
			name: "ties go to the lower line, shared after cost",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10"), line(3, "a", 1, "10")},
				func(in *OrderCostInput) { in.SharedCosts = []decimal.Decimal{dd("1")} }),
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
				func(in *OrderCostInput) { in.Currency = "TWD"; in.Rate = dp("0.03") }),
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
			name: "team overrides first, then by amount within the team",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "30"), line(3, "b", 1, "20")}, func(in *OrderCostInput) {
				in.SharedCosts = []decimal.Decimal{dd("100")}
				in.TeamOverrides = []TeamOverride{{TeamID: "a", Amount: dd("70")}, {TeamID: "b", Amount: dd("30")}}
			}),
			cost: []string{"10.00", "30.00", "20.00"}, shared: []string{"17.50", "52.50", "30.00"}, target: "160.00", net: "160.00",
		},
		{
			name: "a discount larger than the fee still sums to the target",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "10")}, func(in *OrderCostInput) {
				in.SharedCosts = []decimal.Decimal{dd("5"), dd("-12.01")}
			}),
			cost: []string{"10.00", "10.00"}, shared: []string{"-3.50", "-3.51"}, target: "12.99", net: "12.99",
		},
		{
			name: "zero base splits equally",
			in: usd([]CostLine{line(1, "a", 1, "0"), line(2, "a", 1, "0"), line(3, "a", 1, "0")},
				func(in *OrderCostInput) { in.SharedCosts = []decimal.Decimal{dd("3")} }),
			cost: []string{"0.00", "0.00", "0.00"}, shared: []string{"1.00", "1.00", "1.00"}, target: "3.00", net: "3.00",
		},
		{
			name: "ledger: assigned to its line, unassigned by cost+shared",
			in: usd([]CostLine{line(1, "a", 1, "10"), line(2, "a", 1, "30")}, func(in *OrderCostInput) {
				in.Ledger = []LedgerAmount{{AmountBase: dd("-3"), LineNo: 2}, {AmountBase: dd("4")}}
			}),
			cost: []string{"10.00", "30.00"}, shared: []string{"0.00", "0.00"}, ledger: []string{"1.00", "0.00"}, target: "40.00", net: "41.00",
		},
		{
			name: "zero-decimal base currency rounds half away from zero",
			in:   OrderCostInput{Currency: "USD", Base: "JPY", BaseDigits: 0, Lines: []CostLine{line(1, "a", 1, "1")}, Rate: dp("149.5")},
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
			for i := range tt.cost {
				if c := str(got.Lines[i].CostBase); c != tt.cost[i] {
					t.Errorf("line %d costBase = %s, want %s", i+1, c, tt.cost[i])
				}
				if s := str(got.Lines[i].SharedBase); s != tt.shared[i] {
					t.Errorf("line %d sharedBase = %s, want %s", i+1, s, tt.shared[i])
				}
				if tt.ledger != nil && str(got.Lines[i].LedgerBase) != tt.ledger[i] {
					t.Errorf("line %d ledgerBase = %s, want %s", i+1, str(got.Lines[i].LedgerBase), tt.ledger[i])
				}
			}
			if !got.InvariantHolds() {
				t.Errorf("netBase != Σ totalBase")
			}
		})
	}
}

// netBase = target + Σledger = Σ line totalBase for random orders, including
// discounts larger than fees, zero prices and unassigned refunds.
func TestOrderCostInvariant(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	price := func() string { return decimal.New(rng.Int63n(2000), -int32(rng.Intn(3))).String() }
	for n := 0; n < 300; n++ {
		in := OrderCostInput{Currency: "EUR", Base: "USD", BaseDigits: 2}
		for i := 1; i <= 1+rng.Intn(5); i++ {
			in.Lines = append(in.Lines, line(i, []string{"a", "b"}[rng.Intn(2)], 1+rng.Intn(4), price()))
		}
		for i := 0; i < rng.Intn(3); i++ {
			in.SharedCosts = append(in.SharedCosts, decimal.New(rng.Int63n(4000)-2000, -2))
		}
		for i := 0; i < rng.Intn(3); i++ {
			e := LedgerAmount{AmountBase: decimal.New(rng.Int63n(4000)-2000, -2)}
			if rng.Intn(2) == 0 {
				e.LineNo = 1 + rng.Intn(len(in.Lines))
			}
			in.Ledger = append(in.Ledger, e)
		}
		if rng.Intn(2) == 0 {
			in.ChargedBase = dp(decimal.New(rng.Int63n(100000), -2).String())
		} else {
			in.Rate = dp("1.0837")
		}
		got := CalcOrderCost(in)
		if !got.InvariantHolds() {
			t.Fatalf("invariant broken for %+v: %+v", in, got)
		}
		if got.TargetBase != nil {
			sum := decimal.Zero
			for _, l := range got.Lines {
				sum = sum.Add(*l.CostBase).Add(*l.SharedBase)
			}
			if !sum.Equal(*got.TargetBase) {
				t.Fatalf("Σ cost+shared = %s, target %s", sum, got.TargetBase)
			}
		}
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
