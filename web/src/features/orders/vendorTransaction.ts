import type { Batch, Item, Me, PatchVendorTransactionRequest, SharedCostType, VendorTransactionView } from '../../api/types';
import { ZERO, add, isZero, parseDecSafe, type Dec } from '../batches/decimal';
import { deadlineChange } from '../batches/datetime';
import { callerFor } from '../batches/rules';
import { validateAmount, type AmountError } from '../money';
import { isPurchaser } from './rules';

export const SHARED_COST_TYPES: SharedCostType[] = ['shipping', 'fee', 'tax', 'discount', 'other'];

/**
 * Editing needs purchaser rights on every involved batch (spec 10.3). Hidden orders mean batches the caller cannot read,
 * so the page stays read-only then; the server stays authoritative.
 */
export function canManageVendorTransaction(me: Pick<Me, 'id' | 'isSystemAdmin' | 'memberships'> | undefined, batches: Batch[], hiddenOrderCount: number): boolean {
  if (!me || batches.length === 0 || hiddenOrderCount > 0) return false;
  return batches.every((b) => isPurchaser(b, callerFor(me, b.teamId)));
}

export interface SharedCostRow {
  type: SharedCostType;
  amount: string;
  note: string;
}

export interface Validated<T> {
  value: T;
  /** Per-row error, null for valid rows. Empty `errors` entries mean the whole input is valid. */
  errors: (AmountError | null)[];
  valid: boolean;
}

/** Shared cost amounts use the external order's currency; a discount must not be positive. */
export function sharedCostRequests(rows: SharedCostRow[], digits: number | undefined): Validated<NonNullable<PatchVendorTransactionRequest['sharedCosts']>> {
  const errors = rows.map((r) => validateAmount(r.amount, { digits, sign: r.type === 'discount' ? 'nonPositive' : 'any' }));
  return {
    value: rows.map((r) => ({ type: r.type, amount: r.amount.trim(), ...(r.note.trim() ? { note: r.note.trim() } : {}) })),
    errors,
    valid: errors.every((e) => e === null),
  };
}

export function sharedCostsTotal(rows: Pick<SharedCostRow, 'amount'>[]): Dec {
  return rows.reduce((sum, r) => add(sum, parseDecSafe(r.amount)), ZERO);
}

export interface AllocationCheck {
  sum: Dec;
  /** The shares add up exactly to the shared costs total. */
  matches: boolean;
  /** Any share differs from what the server currently holds: needs an override reason. */
  changed: boolean;
  errors: Record<string, AmountError | null>;
  valid: boolean;
}

const eq = (a: Dec, b: Dec) => isZero(add(a, { n: -b.n, s: b.s }));

/** Client-side check of manual shares against the stored ones and the shared-costs total. */
export function checkAllocations(shares: Record<string, string>, stored: Record<string, string>, total: Dec, digits: number | undefined): AllocationCheck {
  const errors: Record<string, AmountError | null> = {};
  let sum = ZERO;
  let changed = false;
  for (const [id, v] of Object.entries(shares)) {
    errors[id] = validateAmount(v, { digits, sign: 'any' });
    sum = add(sum, parseDecSafe(v));
    if (!eq(parseDecSafe(v), parseDecSafe(stored[id]))) changed = true;
  }
  const matches = eq(sum, total);
  return { sum, matches, changed, errors, valid: matches && Object.values(errors).every((e) => e === null) };
}

/** Request body for PATCH allocations: every order exactly once. */
export function allocationRequests(shares: Record<string, string>): NonNullable<PatchVendorTransactionRequest['allocations']> {
  return Object.entries(shares).map(([orderId, v]) => ({ orderId, shareOfSharedCosts: v.trim() }));
}

/** Only edited prices are sent; a blank field clears the price (null). Prices are not negative. */
export function itemPriceRequests(
  edits: Record<string, string>, items: Pick<Item, 'id' | 'actualUnitPrice'>[], currency: string, digits: number | undefined,
): Validated<NonNullable<PatchVendorTransactionRequest['itemPrices']>> & { byItem: Record<string, AmountError | null> } {
  const byItem: Record<string, AmountError | null> = {};
  const value: NonNullable<PatchVendorTransactionRequest['itemPrices']> = [];
  for (const it of items) {
    const typed = edits[it.id];
    if (typed === undefined || typed.trim() === (it.actualUnitPrice?.amount ?? '')) continue;
    if (typed.trim() === '') {
      byItem[it.id] = null;
      value.push({ itemId: it.id, actualUnitPrice: null });
      continue;
    }
    byItem[it.id] = validateAmount(typed, { digits });
    value.push({ itemId: it.id, actualUnitPrice: { amount: typed.trim(), currency } });
  }
  const errors = Object.values(byItem);
  return { value, errors, valid: errors.every((e) => e === null), byItem };
}

/** chargedAmountBase: blank clears it (null); otherwise a non-negative amount in the base currency. */
export function chargedAmountRequest(input: string, digits: number | undefined): { value: string | null; error: AmountError | null } {
  const s = input.trim();
  if (s === '') return { value: null, error: null };
  return { value: s, error: validateAmount(s, { digits }) };
}

export interface DetailsForm {
  vendor: string;
  externalOrderNo: string;
  paymentNote: string;
  /** datetime-local value */
  expectedDelivery: string;
  chargedAmountBase: string;
}

export function detailsToForm(v: Pick<VendorTransactionView, 'vendor' | 'externalOrderNo' | 'paymentNote' | 'expectedDeliveryDate' | 'chargedAmountBase'>, toLocal: (iso: string | null) => string): DetailsForm {
  return { vendor: v.vendor, externalOrderNo: v.externalOrderNo, paymentNote: v.paymentNote, expectedDelivery: toLocal(v.expectedDeliveryDate), chargedAmountBase: v.chargedAmountBase ?? '' };
}

/** PATCH body with only the fields that changed; `charged` carries the validation error of the charged amount. */
export function detailsPatch(
  form: DetailsForm,
  stored: Pick<VendorTransactionView, 'vendor' | 'externalOrderNo' | 'paymentNote' | 'expectedDeliveryDate' | 'chargedAmountBase'>,
  baseDigits: number | undefined,
): { body: PatchVendorTransactionRequest; charged: AmountError | null; valid: boolean } {
  const body: PatchVendorTransactionRequest = {};
  if (form.vendor.trim() !== stored.vendor) body.vendor = form.vendor.trim();
  if (form.externalOrderNo.trim() !== stored.externalOrderNo) body.externalOrderNo = form.externalOrderNo.trim();
  if (form.paymentNote !== stored.paymentNote) body.paymentNote = form.paymentNote;
  const delivery = deadlineChange(stored.expectedDeliveryDate, form.expectedDelivery);
  if (delivery !== undefined) body.expectedDeliveryDate = delivery;
  const charged = chargedAmountRequest(form.chargedAmountBase, baseDigits);
  if (!charged.error && charged.value !== (stored.chargedAmountBase ?? null)) body.chargedAmountBase = charged.value;
  // A blank vendor is never valid; an unparseable delivery time leaves the field unchanged, so it is flagged by the page.
  const vendorOk = form.vendor.trim() !== '';
  return { body, charged: charged.error, valid: vendorOk && !charged.error && Object.keys(body).length > 0 };
}
