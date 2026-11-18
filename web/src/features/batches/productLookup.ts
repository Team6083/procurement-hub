import type { components } from '../../api/schema';
import type { ItemForm } from './itemForm';

export type LookupResult = components['schemas']['LookupResult'];

/** Item request field names recorded server side in `lookup.autoFilledFields`. */
export type LookupField = 'name' | 'vendorId' | 'sku' | 'estimatedUnitPrice' | 'productUrl';

/** Which lookup field a form input belongs to (an edit of the input ends its auto-filled mark). */
export const FORM_TO_LOOKUP_FIELD: Partial<Record<keyof ItemForm, LookupField>> = {
  name: 'name', vendorId: 'vendorId', vendorName: 'vendorId', sku: 'sku', unitPrice: 'estimatedUnitPrice', currency: 'estimatedUnitPrice', productUrl: 'productUrl',
};

export interface LookupPatch {
  field: LookupField;
  values: Partial<ItemForm>;
}

/** The only provider today; /meta does not say which one is configured. */
export const LOOKUP_PROVIDER = 'partfinder';

/**
 * Splits a lookup result into patches for empty form fields (`fills`) and for non-empty fields whose value
 * differs from the result (`conflicts`, applied only after the user confirms). Unknown result values are skipped.
 */
export function planLookupFill(form: ItemForm, r: LookupResult, currencies: string[]): { fills: LookupPatch[]; conflicts: LookupPatch[] } {
  const fills: LookupPatch[] = [];
  const conflicts: LookupPatch[] = [];
  const add = (field: LookupField, empty: boolean, same: boolean, values: Partial<ItemForm>) => {
    if (same) return;
    (empty ? fills : conflicts).push({ field, values });
  };
  const text = (field: LookupField, key: 'name' | 'sku' | 'productUrl', value: string) => {
    const v = value.trim();
    if (v) add(field, form[key].trim() === '', form[key].trim() === v, { [key]: v });
  };
  text('name', 'name', r.name);
  text('sku', 'sku', r.sku);
  text('productUrl', 'productUrl', r.url);
  if (r.vendorId || r.vendorName.trim()) {
    const id = r.vendorId ?? 'other';
    const name = r.vendorId ? '' : r.vendorName.trim();
    const empty = form.vendorId === '' || (form.vendorId === 'other' && form.vendorName.trim() === '');
    add('vendorId', empty, form.vendorId === id && (id !== 'other' || form.vendorName.trim() === name), { vendorId: id, vendorName: name });
  }
  const p = r.unitPrice;
  if (p && currencies.includes(p.currency)) {
    add('estimatedUnitPrice', form.unitPrice.trim() === '', form.unitPrice.trim() === p.amount && form.currency === p.currency, { unitPrice: p.amount, currency: p.currency });
  }
  return { fills, conflicts };
}
