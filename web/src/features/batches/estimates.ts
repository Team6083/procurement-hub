import { ZERO, add, format, mul, mulInt, parseDecSafe, toFixed, type Dec } from './decimal';

export interface PricedItem {
  quantity: number;
  estimatedUnitPrice: { amount: string; currency: string };
}
export interface RateLike {
  currency: string;
  rateToBase: string;
}
export interface CurrencyAmount {
  currency: string;
  amount: string;
}
export interface Estimate {
  /** Sum per item currency, exact. */
  byCurrency: CurrencyAmount[];
  /** Converted total in the base currency (rounded half-up to 2 decimals); excludes the no-rate bucket. */
  base: string;
  /** Item-currency totals that could not be converted (no reference rate). */
  noRate: CurrencyAmount[];
}

/** quantity x unit price, exact, in the item currency. */
export function lineTotal(item: PricedItem): Dec {
  return mulInt(parseDecSafe(item.estimatedUnitPrice.amount), item.quantity);
}

function sumBy(items: PricedItem[]): Map<string, Dec> {
  const m = new Map<string, Dec>();
  for (const it of items) {
    const c = it.estimatedUnitPrice.currency;
    m.set(c, add(m.get(c) ?? ZERO, lineTotal(it)));
  }
  return m;
}

const toList = (m: Map<string, Dec>): CurrencyAmount[] =>
  [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, d]) => ({ currency, amount: format(d) }));

/** Per-currency totals plus a base-currency estimate (spec §11); rate-less currencies go to `noRate`. */
export function estimate(items: PricedItem[], rates: RateLike[], baseCurrency: string): Estimate {
  const sums = sumBy(items);
  let base = ZERO;
  const noRate = new Map<string, Dec>();
  for (const [currency, total] of sums) {
    if (currency === baseCurrency) {
      base = add(base, total);
      continue;
    }
    const rate = rates.find((r) => r.currency === currency);
    if (rate) base = add(base, mul(total, parseDecSafe(rate.rateToBase)));
    else noRate.set(currency, total);
  }
  return { byCurrency: toList(sums), base: toFixed(base, 2), noRate: toList(noRate) };
}
