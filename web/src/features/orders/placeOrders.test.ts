import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../../api/types';
import { batch, item } from '../../test/fakeApi';
import { callerFor } from '../batches/rules';
import {
  availableRows, externalOrderGroups, groupByVendor, groupItemsByVendor, planOrders, readyItemRows, runExternalOrder, selectedItemRows, selectedRows,
  toggleGroup, toggleItemGroup, type OrderPlan,
} from './placeOrders';

const at = '2026-01-01T00:00:00Z';
const order = (id: string, batchId: string, number: number, over: Partial<Order> = {}): Order => ({
  id, teamId: 't1', batchId, number, vendor: 'Acme', itemIds: ['i1'], vendorTransactionId: null, status: 'draft',
  itemsCostBase: '0', sharedCostBase: '0', adjustmentsBase: '0', totalBase: '0', costsProvisional: true, createdBy: 'u1', createdAt: at, updatedAt: at, version: 1, ...over,
});
const mine = batch({ id: 'b1', number: 1, status: 'ordering', assignments: { approvers: [], purchasers: ['u1'], receivers: [] } });
const theirs = batch({ id: 'b2', number: 2, teamId: 't2', status: 'ordering', assignments: { approvers: [], purchasers: ['u9'], receivers: [] } });
const closed = batch({ id: 'b3', number: 3, status: 'receiving' });
const me = { id: 'u1', isSystemAdmin: false, memberships: [{ teamId: 't1', role: 'member' }, { teamId: 't2', role: 'member' }] as never };
const callerOf = (b: { teamId: string }) => callerFor(me, b.teamId);

const orders = {
  b1: [order('o1', 'b1', 1, { vendor: 'Zed' }), order('o2', 'b1', 2), order('o3', 'b1', 3, { vendorTransactionId: 'v1', vendor: 'Acme' })],
  b2: [order('o4', 'b2', 1), order('o5', 'b2', 2, { status: 'cancelled' })],
  b3: [order('o6', 'b3', 1)],
};

describe('availableRows', () => {
  const rows = availableRows([mine, theirs, closed], orders, callerOf);
  it('keeps only free drafts of ordering batches, sorted by vendor then batch', () => {
    expect(rows.map((r) => r.order.id)).toEqual(['o2', 'o4', 'o1']);
  });
  it('marks batches without purchaser rights as not selectable', () => {
    expect(rows.map((r) => r.selectable)).toEqual([true, false, true]);
  });
});

describe('grouping and selection', () => {
  const rows = availableRows([mine, theirs], orders, callerOf);
  it('groups consecutive vendors', () => {
    expect(groupByVendor(rows).map((g) => [g.vendor, g.rows.length])).toEqual([['Acme', 2], ['Zed', 1]]);
  });
  it('selects across batches and drops unselectable rows', () => {
    expect(selectedRows(rows, { o1: true, o2: true, o4: true }).map((r) => r.order.id)).toEqual(['o2', 'o1']);
  });
  it('toggles only selectable rows of a group', () => {
    const acme = groupByVendor(rows)[0]!.rows;
    expect(toggleGroup({ o1: true }, acme, true)).toEqual({ o1: true, o2: true });
    expect(toggleGroup({ o1: true, o2: true }, acme, false)).toEqual({ o1: true, o2: false });
  });
});

describe('externalOrderGroups', () => {
  it('finds external orders through their orders, drafts first, ignoring cancelled', () => {
    const o = {
      b1: [order('o1', 'b1', 1, { vendorTransactionId: 'vA', status: 'placed' }), order('o2', 'b1', 2, { vendorTransactionId: 'vB' })],
      b2: [order('o3', 'b2', 1, { vendorTransactionId: 'vA', status: 'placed', vendor: 'Beta' }), order('o4', 'b2', 2, { vendorTransactionId: 'vC', status: 'cancelled' })],
    };
    const g = externalOrderGroups([mine, theirs], o);
    expect(g.map((x) => [x.id, x.status, x.orders.length, x.vendor])).toEqual([['vB', 'draft', 1, 'Acme'], ['vA', 'placed', 2, 'Acme, Beta']]);
  });
});

describe('ready items', () => {
  const itemsByBatch = {
    b1: [item(1, { id: 'a', status: 'approved', vendor: 'Zed' }), item(2, { id: 'b', status: 'approved', vendor: '' }), item(3, { id: 'c', status: 'approved', orderId: 'o1' }), item(4, { id: 'd', status: 'pending' })],
    b2: [item(1, { id: 'e', status: 'approved', vendor: 'Acme' }), item(2, { id: 'f', status: 'approved', vendor: ' Zed ' })],
    b3: [item(1, { id: 'g', status: 'approved', vendor: 'Acme' })],
  };
  const rows = readyItemRows([mine, theirs, closed], itemsByBatch, callerOf);
  it('keeps approved unordered items of ordering batches, sorted by vendor with no vendor last', () => {
    expect(rows.map((r) => r.item.id)).toEqual(['e', 'a', 'f', 'b']);
  });
  it('marks other purchasers batches as not selectable', () => {
    expect(rows.map((r) => r.selectable)).toEqual([false, true, false, true]);
  });
  it('groups by trimmed vendor and keeps a no-vendor group', () => {
    expect(groupItemsByVendor(rows).map((g) => [g.vendor, g.rows.length])).toEqual([['Acme', 1], ['Zed', 2], ['', 1]]);
  });
  it('selects and toggles only selectable items', () => {
    expect(selectedItemRows(rows, { a: true, e: true, b: true }).map((r) => r.item.id)).toEqual(['a', 'b']);
    const zed = groupItemsByVendor(rows)[1]!.rows;
    expect(toggleItemGroup({}, zed, true)).toEqual({ a: true });
  });
  it('plans one team order per batch and vendor', () => {
    const plans = planOrders(readyItemRows([mine, theirs], { b1: itemsByBatch.b1, b2: [item(1, { id: 'e', status: 'approved', batchId: 'b2' })] }, callerOf));
    expect(plans.map((p) => [p.batchId, p.vendor, p.itemIds])).toEqual([['b2', 'Acme', ['e']], ['b1', 'Zed', ['a']], ['b1', '', ['b']]]);
  });
});

describe('runExternalOrder', () => {
  const plans: OrderPlan[] = [
    { key: 'b1\u0000Zed', batchId: 'b1', vendor: 'Zed', itemIds: ['a'] },
    { key: 'b2\u0000', batchId: 'b2', vendor: '', itemIds: ['e'] },
  ];
  const vt = async (body: unknown) => ({ id: 'v', ...(body as object) }) as never;
  it('creates the orders, then the external order over drafts and new orders, filling in the vendor of no-vendor items', async () => {
    const bodies: unknown[] = [];
    let n = 0;
    const created = new Map<string, string>();
    const r = await runExternalOrder({
      plans, draftOrderIds: ['d1'], currency: 'USD', vendor: 'Zed', created,
      createOrder: async (batchId, body) => { bodies.push([batchId, body]); return { id: `n${++n}` } as never; },
      createVendorTransaction: vt,
    });
    expect(bodies).toEqual([['b1', { vendor: 'Zed', itemIds: ['a'] }], ['b2', { vendor: 'Zed', itemIds: ['e'] }]]);
    expect(r).toMatchObject({ orderIds: ['d1', 'n1', 'n2'], currency: 'USD', vendor: 'Zed' });
    expect([...created.values()]).toEqual(['n1', 'n2']);
  });
  it('keeps created orders on failure and does not create them again on retry', async () => {
    const created = new Map<string, string>();
    const createOrder = vi.fn()
      .mockResolvedValueOnce({ id: 'n1' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'n2' });
    const args = { plans, draftOrderIds: [], currency: 'USD', vendor: 'Zed', created, createOrder, createVendorTransaction: vt };
    await expect(runExternalOrder(args)).rejects.toThrow('boom');
    expect([...created.values()]).toEqual(['n1']);
    const r = await runExternalOrder(args);
    expect(createOrder).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ orderIds: ['n1', 'n2'] });
  });
});
