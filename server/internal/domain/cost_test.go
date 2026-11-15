package domain

import (
	"errors"
	"math/rand"
	"testing"

	"github.com/shopspring/decimal"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func dec(s string) decimal.Decimal { return decimal.RequireFromString(s) }

func decs(ss ...string) []decimal.Decimal {
	out := make([]decimal.Decimal, len(ss))
	for i, s := range ss {
		out[i] = dec(s)
	}
	return out
}

func decPtr(s string) *decimal.Decimal { d := dec(s); return &d }

func sameDecs(a, b []decimal.Decimal) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !a[i].Equal(b[i]) {
			return false
		}
	}
	return true
}

func TestLargestRemainder(t *testing.T) {
	tests := []struct {
		name   string
		exact  []string
		total  string
		digits int
		want   []string
	}{
		{"already exact", []string{"1.25", "2.50"}, "3.75", 2, []string{"1.25", "2.5"}},
		{"one unit to the largest remainder", []string{"0.6", "0.6", "0.8"}, "2", 0, []string{"1", "0", "1"}},
		{"ties go to the lower index", []string{"0.5", "0.5"}, "1", 0, []string{"1", "0"}},
		{"thirds", []string{"3.333333", "3.333333", "3.333334"}, "10", 2, []string{"3.33", "3.33", "3.34"}},
		{"three digits", []string{"0.0005", "0.0005"}, "0.001", 3, []string{"0.001", "0"}},
		{"negative total", []string{"-1.5", "-1.5"}, "-3", 0, []string{"-1", "-2"}},
		{"mixed signs", []string{"10.4", "-0.4"}, "10", 0, []string{"10", "0"}},
		{"too much: take units back", []string{"1", "1"}, "1", 0, []string{"1", "0"}},
		{"single value", []string{"7.777"}, "7.78", 2, []string{"7.78"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := LargestRemainder(decs(tt.exact...), dec(tt.total), tt.digits)
			if !sameDecs(got, decs(tt.want...)) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
			sum := decimal.Zero
			for _, g := range got {
				sum = sum.Add(g)
				if !FitsDigits(g, tt.digits) {
					t.Errorf("%s has more than %d digits", g, tt.digits)
				}
			}
			if !sum.Equal(dec(tt.total)) {
				t.Errorf("sum = %s, want %s", sum, tt.total)
			}
		})
	}
	if LargestRemainder(nil, dec("0"), 2) != nil {
		t.Error("no values should give no result")
	}
}

func TestProportionalShares(t *testing.T) {
	tests := []struct {
		name    string
		total   string
		weights []string
		digits  int
		want    []string
	}{
		{"proportional", "4", []string{"10", "30"}, 2, []string{"1", "3"}},
		{"cannot split evenly", "10", []string{"1", "1", "1"}, 2, []string{"3.34", "3.33", "3.33"}},
		{"zero weights split equally", "9", []string{"0", "0"}, 2, []string{"4.5", "4.5"}},
		{"zero weights, odd cent", "0.01", []string{"0", "0"}, 2, []string{"0.01", "0"}},
		{"discount", "-3", []string{"1", "2"}, 0, []string{"-1", "-2"}},
		{"zero total", "0", []string{"5", "7"}, 2, []string{"0", "0"}},
		{"zero-decimals currency", "100", []string{"1", "2"}, 0, []string{"33", "67"}},
		{"one order takes all", "7.25", []string{"3"}, 2, []string{"7.25"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProportionalShares(dec(tt.total), decs(tt.weights...), tt.digits)
			if !sameDecs(got, decs(tt.want...)) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func oid(b byte) bson.ObjectID { return bson.ObjectID{11: b} }

func item(id byte, qty int, price string) CostItem {
	it := CostItem{ID: oid(id), Quantity: qty}
	if price != "" {
		it.UnitPrice = decPtr(price)
	}
	return it
}

func allBase(r CostResult) decimal.Decimal {
	sum := decimal.Zero
	for _, o := range r.Orders {
		sum = sum.Add(o.ItemsCostBase).Add(o.SharedCostBase)
	}
	return sum
}

func TestCalcCosts(t *testing.T) {
	twd := func(in CostInput) CostInput {
		in.Currency, in.Digits, in.BaseCurrency, in.BaseDigits = "USD", 2, "TWD", 0
		return in
	}
	usd := func(in CostInput) CostInput {
		in.Currency, in.Digits, in.BaseCurrency, in.BaseDigits = "USD", 2, "USD", 2
		return in
	}
	twoTeams := []CostOrder{
		{ID: oid(1), Items: []CostItem{item(10, 1, "10")}},
		{ID: oid(2), Items: []CostItem{item(20, 1, "30")}},
	}

	tests := []struct {
		name        string
		in          CostInput
		complete    bool
		provisional bool
		// per order: items, shared, adjustments, total (base); nil when not complete
		want    [][4]string
		items   map[byte]string
		shares  []string // allocation in C
		wantErr error
	}{
		{
			// Acceptance criterion 5: two teams, one USD external order with
			// shipping, TWD charged; everything adds up to the charge.
			name:     "charged amount spreads exactly (acceptance 5)",
			in:       twd(CostInput{Orders: twoTeams, SharedTotal: dec("4"), ChargedBase: decPtr("1400")}),
			complete: true,
			want:     [][4]string{{"318", "32", "0", "350"}, {"955", "95", "0", "1050"}},
			items:    map[byte]string{10: "318", 20: "955"},
			shares:   []string{"1", "3"},
		},
		{
			name: "base currency without a charge is exact",
			in: usd(CostInput{
				Orders: []CostOrder{
					{ID: oid(1), Items: []CostItem{item(10, 3, "1.10")}},
					{ID: oid(2), Items: []CostItem{item(20, 2, "2.05")}},
				},
				SharedTotal: dec("3.01"),
			}),
			complete: true,
			want:     [][4]string{{"3.3", "1.34", "0", "4.64"}, {"4.1", "1.67", "0", "5.77"}},
			shares:   []string{"1.34", "1.67"},
		},
		{
			name: "base currency charged differently (card fees)",
			in: usd(CostInput{
				Orders:      twoTeams,
				SharedTotal: dec("0"), ChargedBase: decPtr("41.20"),
			}),
			complete: true,
			want:     [][4]string{{"10.3", "0", "0", "10.3"}, {"30.9", "0", "0", "30.9"}},
		},
		{
			name:        "reference rate is provisional",
			in:          twd(CostInput{Orders: twoTeams, SharedTotal: dec("4"), ReferenceRate: decPtr("30.5")}),
			complete:    true,
			provisional: true,
			// exact: 305, 30.5, 915, 91.5 -> total target 1342 (44*30.5)
			want: [][4]string{{"305", "31", "0", "336"}, {"915", "91", "0", "1006"}},
		},
		{
			name:        "no charge and no rate cannot convert",
			in:          twd(CostInput{Orders: twoTeams, SharedTotal: dec("4")}),
			provisional: true,
			shares:      []string{"1", "3"},
		},
		{
			name: "a missing price cannot convert",
			in: twd(CostInput{
				Orders: []CostOrder{
					{ID: oid(1), Items: []CostItem{item(10, 1, "10"), item(11, 1, "")}},
					{ID: oid(2), Items: []CostItem{item(20, 1, "30")}},
				},
				ChargedBase: decPtr("1400"),
			}),
			provisional: true,
			shares:      []string{"0", "0"},
		},
		{
			name: "adjustments are added to the total",
			in: usd(CostInput{
				Orders: []CostOrder{
					{ID: oid(1), Items: []CostItem{item(10, 1, "10")}, AdjustmentsBase: dec("-2.5")},
				},
				SharedTotal: dec("1"),
			}),
			complete: true,
			want:     [][4]string{{"10", "1", "-2.5", "8.5"}},
			shares:   []string{"1"},
		},
		{
			name: "manual allocation",
			in: twd(CostInput{
				Orders: twoTeams, SharedTotal: dec("4"), ChargedBase: decPtr("1400"),
				ManualShares: decs("2.5", "1.5"),
			}),
			complete: true,
			// exact: 318.18, 79.55, 954.55, 47.73 -> floors 318,79,954,47 = 1398; +1 to .73, then to the
			// lower index of the .55 tie
			want:   [][4]string{{"318", "80", "0", "398"}, {"954", "48", "0", "1002"}},
			shares: []string{"2.5", "1.5"},
		},
		{
			name: "discount is a negative shared cost",
			in: usd(CostInput{
				Orders:      twoTeams,
				SharedTotal: dec("-4"),
			}),
			complete: true,
			want:     [][4]string{{"10", "-1", "0", "9"}, {"30", "-3", "0", "27"}},
		},
		{
			name: "equal split when every price is zero",
			in: usd(CostInput{
				Orders:      []CostOrder{{ID: oid(1), Items: []CostItem{item(10, 1, "0")}}, {ID: oid(2), Items: []CostItem{item(20, 1, "0")}}},
				SharedTotal: dec("5"),
			}),
			complete: true,
			want:     [][4]string{{"0", "2.5", "0", "2.5"}, {"0", "2.5", "0", "2.5"}},
		},
		{
			name: "zero priced total with a charge cannot be spread",
			in: usd(CostInput{
				Orders: []CostOrder{{ID: oid(1), Items: []CostItem{item(10, 1, "0")}}}, ChargedBase: decPtr("5"),
			}),
			provisional: true,
			wantErr:     ErrCostBasisZero,
		},
		{
			name: "manual allocation must add up",
			in: twd(CostInput{
				Orders: twoTeams, SharedTotal: dec("4"), ManualShares: decs("2", "1"),
			}),
			wantErr: ErrAllocationSum,
		},
		{
			name: "manual allocation must cover every order",
			in: twd(CostInput{
				Orders: twoTeams, SharedTotal: dec("4"), ManualShares: decs("4"),
			}),
			wantErr: errAllocationSize,
		},
		{
			name: "multiple items per order, three-way split of a charge",
			in: usd(CostInput{
				Orders: []CostOrder{
					{ID: oid(1), Items: []CostItem{item(10, 1, "1"), item(11, 1, "1")}},
					{ID: oid(2), Items: []CostItem{item(20, 1, "1")}},
				},
				ChargedBase: decPtr("10.00"),
			}),
			complete: true,
			want:     [][4]string{{"6.67", "0", "0", "6.67"}, {"3.33", "0", "0", "3.33"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CalcCosts(tt.in)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Complete != tt.complete || got.Provisional != tt.provisional {
				t.Fatalf("complete=%v provisional=%v, want %v %v", got.Complete, got.Provisional, tt.complete, tt.provisional)
			}
			for i, w := range tt.want {
				o := got.Orders[i]
				have := [4]string{o.ItemsCostBase.String(), o.SharedCostBase.String(), o.AdjustmentsBase.String(), o.TotalBase.String()}
				if have != w {
					t.Errorf("order %d: got %v, want %v", i, have, w)
				}
			}
			for id, w := range tt.items {
				if g := got.ItemCostBase[oid(id)]; g.String() != w {
					t.Errorf("item %d: got %s, want %s", id, g, w)
				}
			}
			if tt.shares != nil {
				for i, s := range tt.shares {
					if !got.Orders[i].Share.Equal(dec(s)) {
						t.Errorf("share %d = %s, want %s", i, got.Orders[i].Share, s)
					}
				}
			}
			if !tt.complete && len(got.ItemCostBase) != 0 {
				t.Error("incomplete results must not carry item costs")
			}
			if tt.in.ChargedBase != nil && tt.complete && !allBase(got).Equal(*tt.in.ChargedBase) {
				t.Errorf("sum of base amounts = %s, want the charge %s", allBase(got), tt.in.ChargedBase)
			}
		})
	}
}

// The sum of every computed base amount equals chargedAmountBase for any
// mix of prices, quantities, shared costs and charges (spec §11 step 7).
func TestCalcCostsSumsToChargeForArbitraryInput(t *testing.T) {
	rnd := rand.New(rand.NewSource(6083))
	for iter := 0; iter < 500; iter++ {
		digits := []int{0, 2, 3}[rnd.Intn(3)]
		baseDigits := []int{0, 2}[rnd.Intn(2)]
		money := func(max int) decimal.Decimal { return decimal.New(int64(rnd.Intn(max)), int32(-digits)) }
		var orders []CostOrder
		for o := 0; o < 1+rnd.Intn(4); o++ {
			co := CostOrder{ID: oid(byte(o + 1))}
			for i := 0; i < 1+rnd.Intn(4); i++ {
				p := money(100000)
				co.Items = append(co.Items, CostItem{ID: oid(byte(o*10 + i + 50)), Quantity: 1 + rnd.Intn(9), UnitPrice: &p})
			}
			orders = append(orders, co)
		}
		shared := money(5000)
		if rnd.Intn(4) == 0 {
			shared = shared.Neg() // a discount
		}
		charged := decimal.New(int64(1+rnd.Intn(10_000_000)), int32(-baseDigits))
		got, err := CalcCosts(CostInput{
			Currency: "USD", Digits: digits, BaseCurrency: "TWD", BaseDigits: baseDigits,
			Orders: orders, SharedTotal: shared, ChargedBase: &charged,
		})
		if errors.Is(err, ErrCostBasisZero) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if !got.Complete || got.Provisional {
			t.Fatalf("iter %d: complete=%v provisional=%v", iter, got.Complete, got.Provisional)
		}
		if !allBase(got).Equal(charged) {
			t.Fatalf("iter %d: sum = %s, charge = %s", iter, allBase(got), charged)
		}
		itemSum := decimal.Zero
		for _, v := range got.ItemCostBase {
			itemSum = itemSum.Add(v)
			if !FitsDigits(v, baseDigits) {
				t.Fatalf("iter %d: %s exceeds %d digits", iter, v, baseDigits)
			}
		}
		shareSum := decimal.Zero
		for _, o := range got.Orders {
			shareSum = shareSum.Add(o.Share)
		}
		if !shareSum.Equal(shared) {
			t.Fatalf("iter %d: allocations sum to %s, want %s", iter, shareSum, shared)
		}
	}
}

func TestEstimateTotals(t *testing.T) {
	money := func(a, c string) Money { return Money{Amount: Decimal{dec(a)}, Currency: c} }
	rates := map[string]decimal.Decimal{"USD": dec("31.255"), "JPY": dec("0.21")}
	tests := []struct {
		name    string
		lines   []EstimateLine
		by      []string // currency=total
		base    string
		missing []string
	}{
		{"empty", nil, nil, "0", nil},
		{
			"base currency needs no rate",
			[]EstimateLine{{2, money("10.5", "TWD")}, {1, money("4", "TWD")}},
			[]string{"TWD=25"}, "25", nil,
		},
		{
			"converted with rates and rounded",
			[]EstimateLine{{3, money("2", "USD")}, {10, money("100", "JPY")}, {1, money("50", "TWD")}},
			[]string{"JPY=1000", "TWD=50", "USD=6"}, "448", nil, // 6*31.255=187.53, 1000*.21=210, +50 = 447.53
		},
		{
			"currencies without a rate are listed, not converted",
			[]EstimateLine{{1, money("9", "EUR")}, {1, money("1", "CHF")}, {1, money("1", "TWD")}},
			[]string{"CHF=1", "EUR=9", "TWD=1"}, "1", []string{"CHF", "EUR"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTotals(tt.lines, rates, "TWD", 0)
			var by []string
			for _, c := range got.ByCurrency {
				by = append(by, c.Currency+"="+c.Total.String())
			}
			if len(by) != len(tt.by) {
				t.Fatalf("by currency = %v, want %v", by, tt.by)
			}
			for i := range by {
				if by[i] != tt.by[i] {
					t.Fatalf("by currency = %v, want %v", by, tt.by)
				}
			}
			if got.TotalBase.String() != tt.base {
				t.Errorf("total base = %s, want %s", got.TotalBase, tt.base)
			}
			if len(got.MissingRates) != len(tt.missing) {
				t.Fatalf("missing = %v, want %v", got.MissingRates, tt.missing)
			}
			for i := range tt.missing {
				if got.MissingRates[i] != tt.missing[i] {
					t.Errorf("missing = %v, want %v", got.MissingRates, tt.missing)
				}
			}
		})
	}
}
