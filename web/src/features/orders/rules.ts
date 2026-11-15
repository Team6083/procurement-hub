import type { Batch, Item, Order } from '../../api/types';
import { isMember, isTeamAdmin, type Caller } from '../batches/rules';

/** Purchasers and team admins; system admins have no implicit purchaser role (spec 10.3). */
export function isPurchaser(b: Pick<Batch, 'assignments'>, c: Caller): boolean {
  return !c.archived && isMember(c) && (isTeamAdmin(c) || b.assignments.purchasers.includes(c.userId));
}

/** Orders tab: same internal roles as Review (members and system admins). */
export const canSeeOrders = (c: Caller) => isMember(c) || c.isSystemAdmin;

/** Approved items that are in no live order (cancelled orders release their items). */
export function orderableItems(items: Item[]): Item[] {
  return items.filter((i) => i.status === 'approved' && !i.orderId);
}

/** Creating or changing team orders needs an ordering batch. */
export function canCreateOrder(b: Pick<Batch, 'status' | 'assignments'>, c: Caller): boolean {
  return b.status === 'ordering' && isPurchaser(b, c);
}

/** PATCH/DELETE /orders/{id}: draft order outside any external order, batch ordering or receiving. */
export function canChangeOrder(o: Pick<Order, 'status' | 'vendorTransactionId'>, b: Pick<Batch, 'status' | 'assignments'>, c: Caller): boolean {
  return (b.status === 'ordering' || b.status === 'receiving') && o.status === 'draft' && !o.vendorTransactionId && isPurchaser(b, c);
}

/** Draft orders that can go into a new external order. */
export const isAvailableOrder = (o: Pick<Order, 'status' | 'vendorTransactionId'>) => o.status === 'draft' && !o.vendorTransactionId;

export function canCreateVendorTransaction(b: Pick<Batch, 'status' | 'assignments'>, c: Caller): boolean {
  return b.status === 'ordering' && isPurchaser(b, c);
}

/** Adjustments: placed orders in any batch status. */
export function canAdjust(o: Pick<Order, 'status'>, b: Pick<Batch, 'assignments'>, c: Caller): boolean {
  return o.status === 'placed' && isPurchaser(b, c);
}

/** The vendor all given names agree on (case-sensitive, trimmed), '' when they differ or are empty. */
export function commonVendor(vendors: string[]): string {
  const set = new Set(vendors.map((v) => v.trim()));
  if (set.size !== 1) return '';
  return [...set][0] ?? '';
}

/** Most common estimate currency among items; falls back to `fallback`. Ties go to the alphabetically first. */
export function defaultCurrency(items: Pick<Item, 'estimatedUnitPrice'>[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.estimatedUnitPrice.currency, (counts.get(i.estimatedUnitPrice.currency) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? fallback;
}

export const MAX_VENDOR_LENGTH = 200;
export const MAX_REASON_LENGTH = 500;
