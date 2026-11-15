import { describe, expect, it } from 'vitest';
import type { Batch, Item, Order } from '../../api/types';
import type { Caller } from '../batches/rules';
import { parseDec } from '../batches/decimal';
import { checkAdjustment } from './adjustment';
import {
  canAdjust, canChangeOrder, canCreateOrder, canSeeOrders, commonVendor, defaultCurrency, isAvailableOrder, orderableItems,
} from './rules';
import {
  allocationRequests, canManageVendorTransaction, checkAllocations, chargedAmountRequest, detailsPatch, itemPriceRequests, sharedCostRequests,
  sharedCostsTotal,
} from './vendorTransaction';

const caller = (o: Partial<Caller> = {}): Caller => ({ userId: 'u1', isSystemAdmin: false, teamRole: 'member', archived: false, ...o });
const batch = (o: Partial<Batch> = {}) =>
  ({ id: 'b1', teamId: 't1', status: 'ordering', assignments: { approvers: [], purchasers: ['u1'], receivers: [] }, ...o }) as Batch;
const order = (o: Partial<Order> = {}) => ({ id: 'o1', status: 'draft', vendorTransactionId: null, ...o }) as Order;
const item = (o: Partial<Item> = {}) => ({ id: 'i1', status: 'approved', orderId: null, estimatedUnitPrice: { amount: '1', currency: 'USD' }, ...o }) as Item;

describe('order rules', () => {
  it('only purchasers and team admins create orders, and only while ordering', () => {
    expect(canCreateOrder(batch(), caller())).toBe(true);
    expect(canCreateOrder(batch(), caller({ userId: 'u2' }))).toBe(false);
    expect(canCreateOrder(batch(), caller({ userId: 'u2', teamRole: 'admin' }))).toBe(true);
    expect(canCreateOrder(batch(), caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(false);
    expect(canCreateOrder(batch({ status: 'receiving' }), caller())).toBe(false);
    expect(canCreateOrder(batch(), caller({ archived: true }))).toBe(false);
  });
  it('shows the tab to members and system admins', () => {
    expect(canSeeOrders(caller())).toBe(true);
    expect(canSeeOrders(caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(true);
    expect(canSeeOrders(caller({ teamRole: undefined }))).toBe(false);
  });
  it('changes only free drafts while ordering or receiving', () => {
    expect(canChangeOrder(order(), batch(), caller())).toBe(true);
    expect(canChangeOrder(order(), batch({ status: 'receiving' }), caller())).toBe(true);
    expect(canChangeOrder(order(), batch({ status: 'completed' }), caller())).toBe(false);
    expect(canChangeOrder(order({ vendorTransactionId: 'v1' }), batch(), caller())).toBe(false);
    expect(canChangeOrder(order({ status: 'placed' }), batch(), caller())).toBe(false);
  });
  it('adjusts placed orders in any batch status', () => {
    expect(canAdjust(order({ status: 'placed' }), batch({ status: 'completed' }), caller())).toBe(true);
    expect(canAdjust(order(), batch(), caller())).toBe(false);
    expect(canAdjust(order({ status: 'placed' }), batch(), caller({ userId: 'u2' }))).toBe(false);
  });
  it('lists approved items outside any live order', () => {
    const list = [item({ id: 'a' }), item({ id: 'b', orderId: 'o1' }), item({ id: 'c', status: 'pending' }), item({ id: 'd', status: 'ordered' })];
    expect(orderableItems(list).map((i) => i.id)).toEqual(['a']);
    expect(isAvailableOrder(order())).toBe(true);
    expect(isAvailableOrder(order({ vendorTransactionId: 'v' }))).toBe(false);
  });
  it('proposes a vendor only when all agree', () => {
    expect(commonVendor(['Acme', ' Acme '])).toBe('Acme');
    expect(commonVendor(['Acme', 'Bolt'])).toBe('');
    expect(commonVendor([])).toBe('');
  });
  it('defaults the billing currency to the most common item currency', () => {
    const usd = item({ estimatedUnitPrice: { amount: '1', currency: 'USD' } });
    const twd = item({ estimatedUnitPrice: { amount: '1', currency: 'TWD' } });
    expect(defaultCurrency([usd, twd, twd], 'EUR')).toBe('TWD');
    expect(defaultCurrency([usd, twd], 'EUR')).toBe('TWD'); // tie: alphabetical
    expect(defaultCurrency([], 'EUR')).toBe('EUR');
  });
});

describe('vendor transaction editing', () => {
  it('needs purchaser rights on every batch and no hidden orders', () => {
    const me = { id: 'u1', isSystemAdmin: false, memberships: [{ teamId: 't1', role: 'member' }, { teamId: 't2', role: 'admin' }] } as never;
    const b1 = batch();
    const b2 = batch({ id: 'b2', teamId: 't2', assignments: { approvers: [], purchasers: [], receivers: [] } });
    expect(canManageVendorTransaction(me, [b1, b2], 0)).toBe(true);
    expect(canManageVendorTransaction(me, [b1, batch({ id: 'b3', teamId: 't1', assignments: { approvers: [], purchasers: [], receivers: [] } })], 0)).toBe(false);
    expect(canManageVendorTransaction(me, [b1], 1)).toBe(false);
    expect(canManageVendorTransaction(me, [], 0)).toBe(false);
    expect(canManageVendorTransaction(undefined, [b1], 0)).toBe(false);
  });

  it('validates shared costs and keeps a discount non-positive', () => {
    const r = sharedCostRequests([
      { type: 'shipping', amount: '12.5', note: ' fast ' },
      { type: 'discount', amount: '5', note: '' },
      { type: 'discount', amount: '-5', note: '' },
      { type: 'fee', amount: '1.234', note: '' },
    ], 2);
    expect(r.errors).toEqual([null, 'positive', null, 'digits']);
    expect(r.valid).toBe(false);
    expect(r.value[0]).toEqual({ type: 'shipping', amount: '12.5', note: 'fast' });
    expect(r.value[1]).toEqual({ type: 'discount', amount: '5' });
  });

  it('sums shared costs exactly', () => {
    expect(sharedCostsTotal([{ amount: '0.1' }, { amount: '0.2' }, { amount: '-0.05' }])).toEqual({ n: 25n, s: 2 });
  });

  it('checks manual allocations against the total and the stored shares', () => {
    const stored = { a: '6.00', b: '4.00' };
    const total = parseDec('10');
    const same = checkAllocations(stored, stored, total, 2);
    expect(same).toMatchObject({ matches: true, changed: false, valid: true });
    const moved = checkAllocations({ a: '7', b: '3' }, stored, total, 2);
    expect(moved).toMatchObject({ matches: true, changed: true, valid: true });
    const off = checkAllocations({ a: '7', b: '2.99' }, stored, total, 2);
    expect(off).toMatchObject({ matches: false, valid: false });
    const bad = checkAllocations({ a: 'x', b: '4' }, stored, total, 2);
    expect(bad.errors.a).toBe('format');
    expect(bad.valid).toBe(false);
    expect(allocationRequests({ a: ' 7 ', b: '3' })).toEqual([{ orderId: 'a', shareOfSharedCosts: '7' }, { orderId: 'b', shareOfSharedCosts: '3' }]);
  });

  it('sends only edited prices; blank clears; negative is invalid', () => {
    const items = [
      { id: 'a', actualUnitPrice: { amount: '5', currency: 'USD' } },
      { id: 'b', actualUnitPrice: null },
      { id: 'c', actualUnitPrice: { amount: '2', currency: 'USD' } },
    ];
    const r = itemPriceRequests({ a: '5', b: '7.5', c: '' }, items, 'USD', 2);
    expect(r.value).toEqual([{ itemId: 'b', actualUnitPrice: { amount: '7.5', currency: 'USD' } }, { itemId: 'c', actualUnitPrice: null }]);
    expect(r.valid).toBe(true);
    const bad = itemPriceRequests({ b: '-1' }, items, 'USD', 2);
    expect(bad.byItem.b).toBe('negative');
    expect(bad.valid).toBe(false);
  });

  it('treats a blank charged amount as clearing it', () => {
    expect(chargedAmountRequest('  ', 2)).toEqual({ value: null, error: null });
    expect(chargedAmountRequest('99.5', 2)).toEqual({ value: '99.5', error: null });
    expect(chargedAmountRequest('-1', 2).error).toBe('negative');
  });

  it('builds a details patch with changed fields only', () => {
    const stored = { vendor: 'Acme', externalOrderNo: '', paymentNote: '', expectedDeliveryDate: null, chargedAmountBase: null };
    const form = { vendor: 'Acme', externalOrderNo: 'PO-1', paymentNote: '', expectedDelivery: '', chargedAmountBase: '' };
    expect(detailsPatch(form, stored, 2)).toMatchObject({ body: { externalOrderNo: 'PO-1' }, valid: true });
    expect(detailsPatch({ ...form, externalOrderNo: '' }, stored, 2).valid).toBe(false); // nothing changed
    expect(detailsPatch({ ...form, chargedAmountBase: '120' }, stored, 2).body).toEqual({ externalOrderNo: 'PO-1', chargedAmountBase: '120' });
    expect(detailsPatch({ ...form, chargedAmountBase: 'abc' }, stored, 2)).toMatchObject({ charged: 'format', valid: false });
    expect(detailsPatch({ ...form, vendor: ' ' }, stored, 2).valid).toBe(false);
    const cleared = detailsPatch({ ...form, externalOrderNo: '', chargedAmountBase: '' }, { ...stored, chargedAmountBase: '50' }, 2);
    expect(cleared.body).toEqual({ chargedAmountBase: null });
  });
});

describe('adjustments', () => {
  it('requires a non-zero base amount and a reason', () => {
    expect(checkAdjustment({ amountBase: '-25.5', reason: ' damaged ', itemId: 'i1' }, 2)).toMatchObject({
      valid: true, body: { amountBase: '-25.5', reason: 'damaged', itemId: 'i1' },
    });
    expect(checkAdjustment({ amountBase: '0', reason: 'x', itemId: '' }, 2).amountError).toBe('zero');
    expect(checkAdjustment({ amountBase: '-1.005', reason: 'x', itemId: '' }, 2).amountError).toBe('digits');
    expect(checkAdjustment({ amountBase: '-1', reason: '  ', itemId: '' }, 2).reasonError).toBe('required');
    expect(checkAdjustment({ amountBase: '-1', reason: 'x'.repeat(501), itemId: '' }, 2).reasonError).toBe('tooLong');
    expect(checkAdjustment({ amountBase: '-1', reason: 'x', itemId: '' }, 2).body).not.toHaveProperty('itemId');
  });
});
