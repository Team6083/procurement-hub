import { z } from 'zod';
import type { Item } from '../../api/types';
import { currencyFractionDigits, fractionDigits } from '../money';

/** Returns the URL only when it is http(s); used before rendering links. */
export function safeHttpUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Messages are i18n keys resolved at render time.
export const itemFormSchema = z.object({
  name: z.string().trim().min(1, 'common:validation.required').max(300, 'common:validation.tooLong'),
  /** A vendor id from the list, 'other' for free text, or '' for none. */
  vendorId: z.string(),
  vendorName: z.string(),
  sku: z.string(),
  quantity: z.string().regex(/^[1-9]\d*$/, 'batches:validation.quantity'),
  unitPrice: z.string().trim().regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/, 'batches:validation.price'),
  currency: z.string().min(1, 'common:validation.required'),
  priority: z.enum(['1', '2', '3', '4', '5']),
  subgroupId: z.string(),
  purpose: z.string().trim().min(1, 'common:validation.required'),
  notes: z.string(),
  productUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || safeHttpUrl(v) !== undefined, 'batches:validation.url'),
}).superRefine((v, ctx) => {
  // Client-side hint only; the server's field error (invalid_request) is authoritative.
  const max = currencyFractionDigits(v.currency);
  if (max !== undefined && fractionDigits(v.unitPrice) > max) {
    ctx.addIssue({ code: 'custom', path: ['unitPrice'], message: 'batches:validation.priceDigits' });
  }
});
export type ItemForm = z.infer<typeof itemFormSchema>;

export function emptyItemForm(currency: string, subgroupId: string): ItemForm {
  return { name: '', vendorId: '', vendorName: '', sku: '', quantity: '1', unitPrice: '', currency, priority: '3', subgroupId, purpose: '', notes: '', productUrl: '' };
}

export function itemToForm(i: Item): ItemForm {
  return {
    name: i.name, vendorId: i.vendorId ?? (i.vendorName ? 'other' : ''), vendorName: i.vendorId ? '' : i.vendorName, sku: i.sku, quantity: String(i.quantity), unitPrice: i.estimatedUnitPrice.amount,
    currency: i.estimatedUnitPrice.currency, priority: String(i.priority) as ItemForm['priority'], subgroupId: i.subgroupId,
    purpose: i.purpose, notes: i.notes, productUrl: i.productUrl,
  };
}

/** The PATCH /items body replaces all editable fields, so always send them all. */
export function toItemRequest(f: ItemForm) {
  return {
    name: f.name.trim(), vendorId: f.vendorId && f.vendorId !== 'other' ? f.vendorId : null,
    vendorName: f.vendorId === 'other' ? f.vendorName.trim() : '', sku: f.sku.trim(), quantity: Number(f.quantity),
    estimatedUnitPrice: { amount: f.unitPrice.trim(), currency: f.currency }, priority: Number(f.priority),
    subgroupId: f.subgroupId, purpose: f.purpose.trim(), notes: f.notes, productUrl: f.productUrl.trim(),
  };
}
