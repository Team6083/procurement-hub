import type { Batch, CreateOrderRequest, CreateVendorTransactionRequest, Item, Order, OrderStatus, VendorTransactionView } from '../../api/types';
import type { Caller } from '../batches/rules';
import { canCreateOrder, canCreateVendorTransaction, isAvailableOrder, orderableItems } from './rules';

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

export interface ItemRow {
  item: Item;
  batch: Batch;
  /** The caller may create orders in this batch (purchaser of an ordering batch). */
  selectable: boolean;
}

/** Approved items in no live order from ordering batches, sorted by vendor (no vendor last), then batch number, then item number. */
export function readyItemRows(batches: Batch[], itemsByBatch: Record<string, Item[] | undefined>, callerOf: (b: Batch) => Caller): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const batch of batches) {
    if (batch.status !== 'ordering') continue;
    const selectable = canCreateOrder(batch, callerOf(batch)) && canCreateVendorTransaction(batch, callerOf(batch));
    for (const item of orderableItems(itemsByBatch[batch.id] ?? [])) rows.push({ item, batch, selectable });
  }
  const vendorOf = (r: ItemRow) => r.item.vendor.trim();
  return rows.sort((a, b) => Number(vendorOf(a) === '') - Number(vendorOf(b) === '') || vendorOf(a).localeCompare(vendorOf(b)) || a.batch.number - b.batch.number || a.item.seqNo - b.item.seqNo);
}

export interface ItemVendorGroup {
  /** Trimmed vendor; '' is the "no vendor" group. */
  vendor: string;
  rows: ItemRow[];
}

/** Consecutive rows of the same (trimmed) vendor; rows are already sorted. */
export function groupItemsByVendor(rows: ItemRow[]): ItemVendorGroup[] {
  const groups: ItemVendorGroup[] = [];
  for (const row of rows) {
    const vendor = row.item.vendor.trim();
    const last = groups[groups.length - 1];
    if (last && last.vendor === vendor) last.rows.push(row);
    else groups.push({ vendor, rows: [row] });
  }
  return groups;
}

export function selectedItemRows(rows: ItemRow[], selection: Record<string, boolean>): ItemRow[] {
  return rows.filter((r) => selection[r.item.id] && r.selectable);
}

export function toggleItemGroup(selection: Record<string, boolean>, rows: ItemRow[], checked: boolean): Record<string, boolean> {
  const next = { ...selection };
  for (const r of rows) if (r.selectable) next[r.item.id] = checked;
  return next;
}

/** One team order to create: a team order has one vendor, so a batch needs one per vendor. */
export interface OrderPlan {
  key: string;
  batchId: string;
  /** '' when the items have no vendor; the external order's vendor is used then. */
  vendor: string;
  itemIds: string[];
}

export function planOrders(rows: ItemRow[]): OrderPlan[] {
  const plans = new Map<string, OrderPlan>();
  for (const { item, batch } of rows) {
    const vendor = item.vendor.trim();
    const key = `${batch.id}\u0000${vendor}`;
    const plan = plans.get(key) ?? { key, batchId: batch.id, vendor, itemIds: [] };
    plan.itemIds.push(item.id);
    plans.set(key, plan);
  }
  return [...plans.values()];
}

export interface RunExternalOrder {
  plans: OrderPlan[];
  /** Existing draft orders that go into the same external order. */
  draftOrderIds: string[];
  currency: string;
  vendor: string;
  /** plan key -> id of the order already created for it; filled in as orders are created, so a retry only creates the missing ones. */
  created: Map<string, string>;
  createOrder: (batchId: string, body: CreateOrderRequest) => Promise<Order>;
  createVendorTransaction: (body: CreateVendorTransactionRequest) => Promise<VendorTransactionView>;
}

/** Team orders one by one, then the external order. Not atomic; safe to run again after a failure. */
export async function runExternalOrder(a: RunExternalOrder): Promise<VendorTransactionView> {
  const orderIds = [...a.draftOrderIds];
  for (const plan of a.plans) {
    let id = a.created.get(plan.key);
    if (!id) {
      const order = await a.createOrder(plan.batchId, { vendor: plan.vendor || a.vendor, itemIds: plan.itemIds });
      id = order.id;
      a.created.set(plan.key, id);
    }
    orderIds.push(id);
  }
  return a.createVendorTransaction({ orderIds, currency: a.currency, vendor: a.vendor });
}
