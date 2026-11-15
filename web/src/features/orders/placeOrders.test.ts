import { describe, expect, it } from 'vitest';
import type { Order } from '../../api/types';
import { batch } from '../../test/fakeApi';
import { callerFor } from '../batches/rules';
import { availableRows, externalOrderGroups, groupByVendor, selectedRows, toggleGroup } from './placeOrders';

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
