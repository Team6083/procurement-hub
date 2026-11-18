import { describe, expect, it } from 'vitest';
import type { CostEntry } from '../../api/types';
import { bodyOf, emptyValues, entryIssues, entryNumbers, linesRequestedBy, manualRemaining, noteRequired, typesFor, type EntryValues } from './costEntries';

const order: { currency: string; status: 'placed' | 'draft' } = { currency: 'USD', status: 'placed' };
const base = (over: Partial<EntryValues>): EntryValues => ({ ...emptyValues(order), type: 'shipping', settlement: 'with_checkout', amount: '10', note: '', ...over });
const paths = (v: EntryValues, o = order) => entryIssues(v, o, 2, ['a', 'b']).map((i) => i.path.join('.'));

describe('entryNumbers', () => {
  it('numbers the non-voided entries by position, oldest first, and skips voided ones', () => {
    const e = (id: string, voided: boolean) => ({ id, voided: voided ? { reason: 'x', by: 'u', at: '' } : null }) as unknown as CostEntry;
    const m = entryNumbers([e('a', false), e('b', true), e('c', false)]);
    expect(m.get('a')).toBe(1);
    expect(m.has('b')).toBe(false);
    expect(m.get('c')).toBe(2);
  });
});

describe('entry validation', () => {
  it('offers refunds and extra charges only on a placed order', () => {
    expect(typesFor(false)).not.toContain('refund');
    expect(typesFor(false)).not.toContain('extra_charge');
    expect(typesFor(true)).toContain('refund');
  });
  it('checks the sign of the amount by type', () => {
    expect(paths(base({ type: 'discount', amount: '5' }))).toContain('amount');
    expect(paths(base({ type: 'discount', amount: '-5' }))).not.toContain('amount');
    expect(paths(base({ type: 'coupon_used', amount: '-5', note: 'n' }))).toContain('amount');
    expect(paths(base({ type: 'tax', amount: '-5' }))).not.toContain('amount');
    expect(paths(base({ amount: '0' }))).toContain('amount');
  });
  it('requires a note for the types and modes that need one', () => {
    expect(noteRequired('shipping', 'all')).toBe(false);
    expect(noteRequired('shipping', 'lines')).toBe(true);
    expect(noteRequired('refund', 'all')).toBe(true);
    expect(paths(base({ type: 'other' }))).toContain('note');
  });
  it('rejects a refund on a draft order', () => {
    expect(paths(base({ type: 'refund', amount: '-1', note: 'n' }), { currency: 'USD', status: 'draft' })).toContain('type');
  });
  it('requires manual amounts to add up and shows what remains', () => {
    const v = base({ mode: 'manual', amount: '10', note: 'n', manual: { a: '4', b: '5' } });
    expect(manualRemaining('10', v.manual, ['a', 'b'])).toBe('1');
    expect(paths(v)).toContain('manual');
    expect(paths({ ...v, manual: { a: '4.5', b: '5.5' } })).not.toContain('manual');
  });
  it('forces separate for refunds and locks with-checkout to the order currency in the body', () => {
    const r = bodyOf(base({ type: 'refund', settlement: 'with_checkout', currency: 'TWD', amount: '-3', actual: '-0.1', note: 'n' }), order, 'USD');
    expect(r.settlement).toBe('separate');
    expect(r.refundMethod).toBe('cash');
    expect(r.actualAmountBase).toBe('-0.1');
    const w = bodyOf(base({ currency: 'TWD' }), order, 'USD');
    expect(w.currency).toBe('USD');
    expect(w.actualAmountBase).toBeNull();
  });
});

describe('linesRequestedBy', () => {
  it('selects every line whose item was requested by the person', () => {
    const lines = [{ id: 'l1', itemId: 'i1' }, { id: 'l2', itemId: 'i2' }, { id: 'l3', itemId: null }, { id: 'l4', itemId: 'i3' }];
    const req = new Map([['i1', 'u1'], ['i2', 'u2'], ['i3', 'u1']]);
    expect(linesRequestedBy(lines, req, 'u1')).toEqual(['l1', 'l4']);
  });
});
