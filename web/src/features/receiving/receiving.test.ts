import { describe, expect, it } from 'vitest';
import type { Batch, Item } from '../../api/types';
import type { Caller } from '../batches/rules';
import {
  canReceive, canResolve, canSeeReceiving, checkException, checkReceipt, checkResolve, closedItems, isReceiver, openExceptionItems,
  remainingQuantity, toReceive,
} from './rules';

const caller = (o: Partial<Caller> = {}): Caller => ({ userId: 'u1', isSystemAdmin: false, teamRole: 'member', archived: false, ...o });
const batch = (o: Partial<Batch> = {}) =>
  ({ id: 'b1', status: 'receiving', assignments: { approvers: [], purchasers: ['p1'], receivers: ['u1'] }, ...o }) as Batch;
const item = (status: Item['status'], o: Partial<Item> = {}) => ({ id: status, status, quantity: 5, receivedQuantity: 2, ...o }) as Item;

describe('receiving rules', () => {
  it('shows the tab from receiving on, to members and system admins', () => {
    expect(canSeeReceiving(batch(), caller())).toBe(true);
    expect(canSeeReceiving(batch({ status: 'completed' }), caller())).toBe(true);
    expect(canSeeReceiving(batch({ status: 'ordering' }), caller())).toBe(false);
    expect(canSeeReceiving(batch(), caller({ teamRole: undefined }))).toBe(false);
    expect(canSeeReceiving(batch(), caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(true);
  });

  it('lets receivers, purchasers and team admins receive, only while the batch is receiving', () => {
    expect(isReceiver(batch(), caller())).toBe(true);
    expect(isReceiver(batch(), caller({ userId: 'p1' }))).toBe(true);
    expect(isReceiver(batch(), caller({ userId: 'x', teamRole: 'admin' }))).toBe(true);
    expect(isReceiver(batch(), caller({ userId: 'x' }))).toBe(false);
    expect(isReceiver(batch(), caller({ isSystemAdmin: true, teamRole: undefined }))).toBe(false);
    expect(isReceiver(batch(), caller({ archived: true }))).toBe(false);
    expect(canReceive(batch({ status: 'completed' }), caller())).toBe(false);
  });

  it('lets only purchasers and team admins resolve', () => {
    expect(canResolve(batch(), caller())).toBe(false);
    expect(canResolve(batch(), caller({ userId: 'p1' }))).toBe(true);
    expect(canResolve(batch(), caller({ userId: 'x', teamRole: 'admin' }))).toBe(true);
    expect(canResolve(batch({ status: 'completed' }), caller({ userId: 'p1' }))).toBe(false);
  });

  it('groups items by receiving state', () => {
    const all = [item('ordered'), item('partially_received'), item('exception'), item('received'), item('accepted_short'), item('not_obtained'), item('approved')];
    expect(toReceive(all).map((i) => i.status)).toEqual(['ordered', 'partially_received']);
    expect(openExceptionItems(all).map((i) => i.status)).toEqual(['exception']);
    expect(closedItems(all)).toHaveLength(3);
    expect(remainingQuantity(item('ordered'))).toBe(3);
    expect(remainingQuantity(item('ordered', { receivedQuantity: 9 }))).toBe(0);
  });
});

describe('checkReceipt', () => {
  it('accepts 1 up to the remaining quantity', () => {
    expect(checkReceipt('3', '', 3)).toMatchObject({ valid: true, body: { quantity: 3 } });
    expect(checkReceipt(' 1 ', ' box dented ', 3).body).toEqual({ quantity: 1, note: 'box dented' });
  });
  it('rejects non-integers, zero and more than remaining', () => {
    expect(checkReceipt('', '', 3).quantityError).toBe('format');
    expect(checkReceipt('1.5', '', 3).quantityError).toBe('format');
    expect(checkReceipt('-1', '', 3).quantityError).toBe('format');
    expect(checkReceipt('0', '', 3).quantityError).toBe('min');
    expect(checkReceipt('4', '', 3).quantityError).toBe('exceeds');
  });
  it('limits the note to 500 characters', () => {
    expect(checkReceipt('1', 'x'.repeat(501), 3).valid).toBe(false);
    expect(checkReceipt('1', 'x'.repeat(500), 3).valid).toBe(true);
  });
});

describe('checkException', () => {
  it('needs a description of at most 2000 characters', () => {
    expect(checkException('damaged', '  ').descriptionError).toBe('required');
    expect(checkException('damaged', 'x'.repeat(2001)).descriptionError).toBe('tooLong');
    expect(checkException('wrong_item', ' Got a blue one ').body).toEqual({ type: 'wrong_item', description: 'Got a blue one' });
  });
});

describe('checkResolve', () => {
  it('exchange sends neither note nor refund', () => {
    expect(checkResolve({ action: 'exchange', note: 'ignored', refund: '5' }, 0, 2)).toMatchObject({ valid: true, body: { action: 'exchange' } });
  });
  it('accept and cancel need a note', () => {
    expect(checkResolve({ action: 'cancel', note: ' ', refund: '' }, 0, 2).noteError).toBe('required');
    expect(checkResolve({ action: 'cancel', note: 'Vendor out of stock', refund: '' }, 0, 2)).toMatchObject({ valid: true, body: { action: 'cancel', note: 'Vendor out of stock' } });
  });
  it('accept needs something received', () => {
    const none = checkResolve({ action: 'accept', note: 'ok', refund: '' }, 0, 2);
    expect(none.nothingReceived).toBe(true);
    expect(none.valid).toBe(false);
    expect(checkResolve({ action: 'accept', note: 'ok', refund: '' }, 2, 2).valid).toBe(true);
  });
  it('validates an optional positive refund', () => {
    expect(checkResolve({ action: 'cancel', note: 'n', refund: '12.5' }, 0, 2).body.refundAmountBase).toBe('12.5');
    expect(checkResolve({ action: 'cancel', note: 'n', refund: '-5' }, 0, 2).refundError).toBe('negative');
    expect(checkResolve({ action: 'cancel', note: 'n', refund: '0' }, 0, 2).refundError).toBe('zero');
    expect(checkResolve({ action: 'cancel', note: 'n', refund: '1.234' }, 0, 2).refundError).toBe('digits');
    expect(checkResolve({ action: 'cancel', note: 'n', refund: 'abc' }, 0, 2).valid).toBe(false);
  });
});
