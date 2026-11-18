import type { CostAllocation, CostEntry, CostEntryBody, VendorOrder } from '../../api/types';
import { add, mulInt, parseDec, toFixed, ZERO, type Dec } from '../batches/decimal';
import { currencyFractionDigits, validateAmount, type AmountError, type AmountRules } from '../money';

export type EntryType = CostEntry['type'];
export type AllocMode = CostAllocation['mode'];

export const ENTRY_TYPES: EntryType[] = ['shipping', 'fee', 'tax', 'discount', 'coupon_used', 'refund', 'extra_charge', 'other'];
/** Refunds and extra charges are always paid or refunded on their own, and only exist once the order is placed. */
export const PLACED_ONLY: EntryType[] = ['refund', 'extra_charge'];
export const NOTE_TYPES: EntryType[] = ['refund', 'extra_charge', 'coupon_used', 'other'];

export const typesFor = (placed: boolean): EntryType[] => (placed ? ENTRY_TYPES : ENTRY_TYPES.filter((x) => !PLACED_ONLY.includes(x)));

export const forcesSeparate = (type: EntryType) => PLACED_ONLY.includes(type);

/** The sign the type demands (spec section 9): discounts and refunds negative, coupon use and extra charges positive. */
export function signOf(type: EntryType): 'negative' | 'positive' | 'any' {
  if (type === 'discount' || type === 'refund') return 'negative';
  if (type === 'coupon_used' || type === 'extra_charge') return 'positive';
  return 'any';
}

export const noteRequired = (type: EntryType, mode: AllocMode) => mode !== 'all' || NOTE_TYPES.includes(type);

/** Whether an entry is created by a problem resolution or a line closure (only undoing that action voids it). */
export const isDerived = (e: CostEntry) => e.source !== 'manual';

/**
 * The number the server uses for an entry in `incomplete` reasons: its 1-based position among the non-voided entries,
 * oldest first (the order of the `costEntries` array). Voided entries have none.
 */
export function entryNumbers(entries: CostEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const e of entries) if (!e.voided) out.set(e.id, ++n);
  return out;
}

/** Typed form values of the cost entry dialog. */
export interface EntryValues {
  type: EntryType;
  settlement: 'with_checkout' | 'separate';
  currency: string;
  amount: string;
  actual: string;
  refundMethod: 'cash' | 'coupon';
  note: string;
  mode: AllocMode;
  teamIds: string[];
  lineIds: string[];
  /** Amount per line id, in the entry currency. */
  manual: Record<string, string>;
}

export const emptyValues = (order: Pick<VendorOrder, 'currency' | 'status'>): EntryValues => ({
  type: order.status === 'placed' ? 'refund' : 'shipping', settlement: order.status === 'placed' ? 'separate' : 'with_checkout', currency: order.currency,
  amount: '', actual: '', refundMethod: 'cash', note: '', mode: 'all', teamIds: [], lineIds: [], manual: {},
});

export function valuesOf(e: CostEntry): EntryValues {
  const a = e.allocation;
  return {
    type: e.type, settlement: e.settlement, currency: e.currency, amount: e.amount, actual: e.actualAmountBase ?? '', refundMethod: e.refundMethod ?? 'cash',
    note: e.note, mode: a.mode, teamIds: a.teamIds ?? [], lineIds: a.lineIds ?? [], manual: Object.fromEntries((a.amounts ?? []).map((x) => [x.lineId, x.amount])),
  };
}

/** The settlement the type forces, else the chosen one; with_checkout always takes the order currency. */
export function effective(v: EntryValues, orderCurrency: string): Pick<EntryValues, 'settlement' | 'currency'> {
  const settlement = forcesSeparate(v.type) ? 'separate' : v.settlement;
  return { settlement, currency: settlement === 'with_checkout' ? orderCurrency : v.currency };
}

const rulesFor = (type: EntryType, digits: number | undefined): AmountRules => {
  const s = signOf(type);
  return { digits, nonZero: true, sign: s === 'negative' ? 'nonPositive' : s === 'positive' ? 'nonNegative' : 'any' };
};

export interface Issue {
  path: (string | number)[];
  /** An i18n key (namespace-qualified). */
  message: string;
}

export const amountIssue = (e: AmountError) => `purchasing:amount.${e}`;

/** Sum of the typed manual amounts (unparseable ones count as zero, they are reported separately). */
export function manualSum(manual: Record<string, string>, lineIds: string[]): Dec {
  let sum = ZERO;
  for (const id of lineIds) {
    const s = manual[id]?.trim();
    if (s && !validateAmount(s, { sign: 'any' })) sum = add(sum, parseDec(s));
  }
  return sum;
}

/** What is still to be spread: amount minus the sum of the manual amounts, as a plain decimal string; null when the amount is not a number. */
export function manualRemaining(amount: string, manual: Record<string, string>, lineIds: string[]): string | null {
  if (validateAmount(amount, { sign: 'any' })) return null;
  const left = add(parseDec(amount), mulInt(manualSum(manual, lineIds), -1));
  return toFixed(left, left.s);
}

/**
 * All client-side checks of the dialog (the server stays authoritative): sign by type, digits of the currency,
 * the base-currency actual amount, the required note and the allocation. `lineIds` are the order's lines (manual mode lists them all).
 */
export function entryIssues(v: EntryValues, order: Pick<VendorOrder, 'currency' | 'status'>, baseDigits: number, lineIds: string[]): Issue[] {
  const out: Issue[] = [];
  const { currency } = effective(v, order.currency);
  const bad = (path: Issue['path'], message: string) => out.push({ path, message });
  const amountErr = validateAmount(v.amount, rulesFor(v.type, currencyFractionDigits(currency)));
  if (amountErr) bad(['amount'], amountIssue(amountErr));
  if (v.actual.trim()) {
    const e = validateAmount(v.actual, rulesFor(v.type, baseDigits));
    if (e) bad(['actual'], amountIssue(e));
  }
  if (PLACED_ONLY.includes(v.type) && order.status !== 'placed') bad(['type'], 'purchasing:costs.errors.placedOnly');
  if (noteRequired(v.type, v.mode) && !v.note.trim()) bad(['note'], 'common:validation.required');
  if (v.mode === 'teams' && v.teamIds.length === 0) bad(['teamIds'], 'purchasing:costs.errors.pickTeams');
  if (v.mode === 'lines' && v.lineIds.length === 0) bad(['lineIds'], 'purchasing:costs.errors.pickLines');
  if (v.mode === 'manual') {
    let typed = 0;
    for (const id of lineIds) {
      const s = v.manual[id]?.trim();
      if (!s) continue;
      typed++;
      const e = validateAmount(s, { sign: 'any', digits: currencyFractionDigits(currency) });
      if (e) bad(['manual', id], amountIssue(e));
    }
    if (typed === 0) bad(['manual'], 'purchasing:costs.errors.manualEmpty');
    else if (!amountErr) {
      const left = manualRemaining(v.amount, v.manual, lineIds);
      if (left !== null && !/^-?[0.]*$/.test(left)) bad(['manual'], 'purchasing:costs.errors.manualSum');
    }
  }
  return out;
}

/** The request body for the dialog's values (call after entryIssues returned nothing). */
export function bodyOf(v: EntryValues, order: Pick<VendorOrder, 'currency'>, baseCurrency: string): CostEntryBody {
  const { settlement, currency } = effective(v, order.currency);
  const separate = settlement === 'separate';
  const actual = v.actual.trim();
  let allocation: CostAllocation = { mode: 'all' };
  if (v.mode === 'teams') allocation = { mode: 'teams', teamIds: v.teamIds };
  if (v.mode === 'lines') allocation = { mode: 'lines', lineIds: v.lineIds };
  if (v.mode === 'manual') {
    allocation = { mode: 'manual', amounts: Object.entries(v.manual).filter(([, a]) => a.trim()).map(([lineId, a]) => ({ lineId, amount: a.trim() })) };
  }
  return {
    type: v.type, settlement, currency, amount: v.amount.trim(),
    actualAmountBase: separate && currency !== baseCurrency && actual ? actual : null,
    refundMethod: v.type === 'refund' ? v.refundMethod : null,
    allocation, note: v.note.trim(),
  };
}

/** Lines whose item was requested by the person (the "pick items requested by" shortcut). */
export function linesRequestedBy(lines: { id: string; requester?: { id: string } | null }[], requesterId: string): string[] {
  return lines.filter((l) => l.requester?.id === requesterId).map((l) => l.id);
}
