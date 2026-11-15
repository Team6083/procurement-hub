import type { Batch, Order, OrderStatus } from '../../api/types';
import type { Caller } from '../batches/rules';
import { canCreateVendorTransaction, isAvailableOrder } from './rules';

export interface OrderRow {
  order: Order;
  batch: Batch;
  /** The caller may put this order in an external order (purchaser of an ordering batch). */
  selectable: boolean;
}

/** Draft orders outside any external order from ordering batches, sorted by vendor, then batch number, then order number. */
export function availableRows(batches: Batch[], ordersByBatch: Record<string, Order[] | undefined>, callerOf: (b: Batch) => Caller): OrderRow[] {
  const rows: OrderRow[] = [];
  for (const batch of batches) {
    if (batch.status !== 'ordering') continue;
    const caller = callerOf(batch);
    for (const order of ordersByBatch[batch.id] ?? []) {
      if (isAvailableOrder(order)) rows.push({ order, batch, selectable: canCreateVendorTransaction(batch, caller) });
    }
  }
  return rows.sort((a, b) => a.order.vendor.localeCompare(b.order.vendor) || a.batch.number - b.batch.number || a.order.number - b.order.number);
}

export interface VendorGroup {
  vendor: string;
  rows: OrderRow[];
}

/** Consecutive rows of the same vendor (rows are already sorted by vendor). */
export function groupByVendor(rows: OrderRow[]): VendorGroup[] {
  const groups: VendorGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.vendor === row.order.vendor) last.rows.push(row);
    else groups.push({ vendor: row.order.vendor, rows: [row] });
  }
  return groups;
}

/** Selected orders that can still be submitted: selected, present and selectable. Selections in other batches are kept. */
export function selectedRows(rows: OrderRow[], selection: Record<string, boolean>): OrderRow[] {
  return rows.filter((r) => selection[r.order.id] && r.selectable);
}

/** Select or clear every selectable row of a group. */
export function toggleGroup(selection: Record<string, boolean>, rows: OrderRow[], checked: boolean): Record<string, boolean> {
  const next = { ...selection };
  for (const r of rows) if (r.selectable) next[r.order.id] = checked;
  return next;
}

export interface ExternalOrderGroup {
  id: string;
  vendor: string;
  /** draft while any of the visible orders is still a draft, otherwise placed. */
  status: Extract<OrderStatus, 'draft' | 'placed'>;
  orders: { order: Order; batch: Batch }[];
}

/**
 * External orders found through their orders' vendorTransactionId (there is no list endpoint). Drafts first,
 * then placed ones; cancelled orders are ignored. The vendor of the external order is not known here, so the
 * orders' common vendor (or their joined vendors) stands in for it.
 */
export function externalOrderGroups(batches: Batch[], ordersByBatch: Record<string, Order[] | undefined>): ExternalOrderGroup[] {
  const map = new Map<string, ExternalOrderGroup>();
  for (const batch of batches) {
    for (const order of ordersByBatch[batch.id] ?? []) {
      if (!order.vendorTransactionId || order.status === 'cancelled') continue;
      const g = map.get(order.vendorTransactionId) ?? { id: order.vendorTransactionId, vendor: '', status: 'placed' as const, orders: [] };
      g.orders.push({ order, batch });
      if (order.status === 'draft') g.status = 'draft';
      map.set(g.id, g);
    }
  }
  for (const g of map.values()) g.vendor = [...new Set(g.orders.map((o) => o.order.vendor))].sort().join(', ');
  return [...map.values()].sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft') || a.vendor.localeCompare(b.vendor));
}
