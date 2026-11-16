import { describe, expect, it } from 'vitest';
import type { Batch, Item } from '../../api/types';
import { filterItems } from './filters';
import { safeHttpUrl, itemFormSchema, toItemRequest, emptyItemForm } from './itemForm';
import { auditActionKey, isZeroId } from './audit';
import { availableActions, canAddItem, canForceReject, canMarkUnpurchasable, canUndoUnpurchasable, canModifyItem, canResubmitItem, canReview, isEditedSinceReturn, showResubmit, type Caller } from './rules';

const asm = (n: number) => ({ approvers: n ? ['a1'] : [], purchasers: n ? ['p1'] : [] });
const batch = (o: Partial<Batch> = {}): Batch =>
  ({ id: 'b', teamId: 't', number: 1, title: 'x', description: '', status: 'draft', origin: 'created', createdBy: 'creator', deadline: null,
    assignments: asm(1), reviewConfirmation: null, visibilityOverride: '', statusReason: '', statusChangedAt: '', createdAt: '', updatedAt: '', version: 1, ...o }) as Batch;
const caller = (o: Partial<Caller> = {}): Caller => ({ userId: 'u1', isSystemAdmin: false, teamRole: 'member', archived: false, isPurchaser: false, isReceiver: false, ...o });
const item = (o: Partial<Item> = {}) => ({ requesterId: 'u1', status: 'pending', updatedAt: '2026-01-02T00:00:00Z', review: null, ...o }) as Item;
const names = (b: Batch, c: Caller, p?: number) => availableActions(b, c, p).map((a) => a.action);

describe('batch action availability', () => {
  it('members get nothing except withdrawing their own proposal', () => {
    expect(names(batch({ status: 'collecting' }), caller())).toEqual([]);
    expect(names(batch({ status: 'proposed', origin: 'proposed', createdBy: 'u1' }), caller())).toEqual(['withdraw_proposal']);
    expect(names(batch({ status: 'proposed', origin: 'proposed', createdBy: 'other' }), caller())).toEqual([]);
  });
  it('team admins see state-appropriate actions', () => {
    const a = caller({ teamRole: 'admin' });
    expect(names(batch({ status: 'draft' }), a, 2)).toEqual(['open', 'start_review', 'cancel']);
    expect(names(batch({ status: 'proposed', origin: 'proposed', createdBy: 'x' }), a, 2)).toEqual(['open', 'start_review', 'reject_proposal']);
    expect(names(batch({ status: 'collecting' }), a)).toEqual(['close', 'cancel']);
    expect(names(batch({ status: 'reviewing' }), a)).toEqual(['reopen', 'cancel', 'confirm_review']);
    for (const s of ['purchasing', 'receiving', 'completed'] as const) expect(names(batch({ status: s }), a)).toEqual([]);
    expect(names(batch({ status: 'proposal_rejected' }), a)).toEqual(['restore_proposal']);
    expect(names(batch({ status: 'cancelled', statusBeforeCancel: 'collecting' }), a)).toEqual(['uncancel']);
    // A withdrawn proposal is restored, never uncancelled.
    expect(names(batch({ status: 'cancelled', statusBeforeCancel: 'proposed' }), a)).toEqual(['restore_proposal']);
  });
  it('approvers confirm and unconfirm the review', () => {
    const approver = caller({ userId: 'a1' });
    const confirmed = { by: 'a1', at: '', purchaseOutside: false };
    expect(availableActions(batch({ status: 'reviewing' }), approver, 0, 2)).toEqual([{ action: 'confirm_review', disabled: 'undecided' }]);
    expect(names(batch({ status: 'reviewing' }), approver, 0)).toEqual(['confirm_review']);
    expect(names(batch({ status: 'purchasing', reviewConfirmation: confirmed }), approver)).toEqual(['unconfirm_review']);
    expect(names(batch({ status: 'reviewing' }), caller())).toEqual([]);
  });
  it('proposer who is also admin gets both', () => {
    expect(names(batch({ status: 'proposed', origin: 'proposed', createdBy: 'u1' }), caller({ teamRole: 'admin' }), 1)).toContain('withdraw_proposal');
  });
  it('flags unmet guards as disabled instead of hiding', () => {
    const a = caller({ teamRole: 'admin' });
    expect(availableActions(batch({ assignments: asm(0) }), a, 1).filter((x) => x.disabled).map((x) => x.action)).toEqual(['open', 'start_review']);
    expect(availableActions(batch(), a, 0).find((x) => x.action === 'start_review')?.disabled).toBe('noPending');
    expect(availableActions(batch(), a, undefined).find((x) => x.action === 'start_review')?.disabled).toBeUndefined();
  });
  it('system admins can administer; archived teams offer nothing', () => {
    expect(names(batch({ status: 'collecting' }), caller({ teamRole: undefined, isSystemAdmin: true }))).toEqual(['close', 'cancel']);
    expect(names(batch({ status: 'collecting' }), caller({ teamRole: 'admin', archived: true }))).toEqual([]);
  });
});

describe('item permissions mirror backend canModify', () => {
  it('requester: pending while proposed/collecting, returned while reviewing', () => {
    const c = caller();
    expect(canModifyItem(item(), batch({ status: 'collecting' }), c)).toBe(true);
    expect(canModifyItem(item(), batch({ status: 'proposed' }), c)).toBe(true);
    expect(canModifyItem(item(), batch({ status: 'reviewing' }), c)).toBe(false);
    expect(canModifyItem(item({ status: 'returned' }), batch({ status: 'reviewing' }), c)).toBe(true);
    expect(canModifyItem(item({ status: 'returned' }), batch({ status: 'collecting' }), c)).toBe(false);
    expect(canModifyItem(item({ status: 'approved' }), batch({ status: 'collecting' }), c)).toBe(false);
  });
  it('others cannot; admins (team or system) only while collecting for pending/returned', () => {
    expect(canModifyItem(item({ requesterId: 'x' }), batch({ status: 'collecting' }), caller())).toBe(false);
    const a = caller({ teamRole: 'admin' });
    expect(canModifyItem(item({ requesterId: 'x' }), batch({ status: 'collecting' }), a)).toBe(true);
    expect(canModifyItem(item({ requesterId: 'x', status: 'returned' }), batch({ status: 'collecting' }), a)).toBe(true);
    expect(canModifyItem(item({ requesterId: 'x' }), batch({ status: 'reviewing' }), a)).toBe(false);
    expect(canModifyItem(item({ requesterId: 'x' }), batch({ status: 'collecting' }), caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(true);
    expect(canModifyItem(item({ requesterId: 'x' }), batch({ status: 'reviewing' }), caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(false);
    expect(canModifyItem(item({ requesterId: 'x', status: 'approved' }), batch({ status: 'collecting' }), caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(false);
  });
  it('adding items: proposer while proposed, members while collecting', () => {
    expect(canAddItem(batch({ status: 'proposed', createdBy: 'u1' }), caller())).toBe(true);
    expect(canAddItem(batch({ status: 'proposed', createdBy: 'x' }), caller())).toBe(false);
    expect(canAddItem(batch({ status: 'collecting' }), caller())).toBe(true);
    expect(canAddItem(batch({ status: 'collecting' }), caller({ teamRole: undefined }))).toBe(false);
    expect(canAddItem(batch({ status: 'draft' }), caller({ teamRole: 'admin' }))).toBe(false);
  });
});

describe('resubmit', () => {
  // The decision produced version 3; an edit raises the item version above it.
  const returned = (version: number) =>
    item({ status: 'returned', version, review: { decision: 'returned', by: 'a', at: '2026-01-02T00:00:00Z', comment: 'fix', forced: false, atVersion: 3 } });
  it('is enabled only once the item version exceeds the review version', () => {
    expect(isEditedSinceReturn(returned(3))).toBe(false);
    expect(isEditedSinceReturn(returned(4))).toBe(true);
  });
  it('is not fooled by timestamps: a later updatedAt without an edit stays disabled', () => {
    const later = item({ status: 'returned', version: 3, updatedAt: '2030-01-01T00:00:00Z', review: returned(3).review });
    expect(isEditedSinceReturn(later)).toBe(false);
  });
  it('requires requester, reviewing batch and returned status', () => {
    const edited = returned(4);
    expect(canResubmitItem(edited, batch({ status: 'reviewing' }), caller())).toBe(true);
    expect(canResubmitItem(returned(3), batch({ status: 'reviewing' }), caller())).toBe(false);
    expect(showResubmit(returned(3), batch({ status: 'reviewing' }), caller())).toBe(true);
    expect(canResubmitItem(edited, batch({ status: 'collecting' }), caller())).toBe(false);
    expect(canResubmitItem({ ...edited, requesterId: 'x' }, batch({ status: 'reviewing' }), caller())).toBe(false);
  });
});

describe('review permissions', () => {
  it('approvers and team admins while reviewing; system admins are not implicit approvers', () => {
    const b = batch({ status: 'reviewing' });
    expect(canReview(b, caller({ userId: 'a1' }))).toBe(true);
    expect(canReview(b, caller())).toBe(false);
    expect(canReview(b, caller({ teamRole: 'admin' }))).toBe(true);
    expect(canReview(b, caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(false);
    expect(canReview(batch({ status: 'collecting' }), caller({ teamRole: 'admin' }))).toBe(false);
  });
  it('force reject: admins on pending/returned items while reviewing', () => {
    const b = batch({ status: 'reviewing' });
    expect(canForceReject(item(), b, caller({ teamRole: 'admin' }))).toBe(true);
    expect(canForceReject(item({ status: 'returned' }), b, caller({ teamRole: undefined, isSystemAdmin: true }))).toBe(true);
    expect(canForceReject(item({ status: 'approved' }), b, caller({ teamRole: 'admin' }))).toBe(false);
    expect(canForceReject(item(), b, caller())).toBe(false);
  });
});

describe('filters, urls, forms, audit helpers', () => {
  it('filters items by exact fields', () => {
    const rows = [
      { subgroupId: 'g1', requesterId: 'u1', priority: 5, status: 'pending', vendor: 'A' },
      { subgroupId: 'g2', requesterId: 'u2', priority: 3, status: 'approved', vendor: 'B' },
    ] as Item[];
    expect(filterItems(rows, {})).toHaveLength(2);
    expect(filterItems(rows, { priority: '5' })).toHaveLength(1);
    expect(filterItems(rows, { subgroup: 'g2', status: 'approved', vendor: 'B', requester: 'u2' })).toHaveLength(1);
    expect(filterItems(rows, { subgroup: 'g2', status: 'pending' })).toHaveLength(0);
  });
  it('only http/https product URLs are links', () => {
    expect(safeHttpUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeHttpUrl('http://example.org')).toBeDefined();
    for (const u of ['javascript:alert(1)', 'ftp://x.org', 'data:text/html,hi', 'not a url', '', undefined]) expect(safeHttpUrl(u)).toBeUndefined();
  });
  it('validates the item form and builds the request', () => {
    const ok = { ...emptyItemForm('TWD', ''), name: 'Cable', unitPrice: '12.5', purpose: 'bench', quantity: '3' };
    expect(itemFormSchema.safeParse(ok).success).toBe(true);
    expect(itemFormSchema.safeParse({ ...ok, quantity: '0' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...ok, unitPrice: '-1' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...ok, productUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...ok, productUrl: '' }).success).toBe(true);
    expect(toItemRequest(ok)).toMatchObject({ quantity: 3, priority: 3, estimatedUnitPrice: { amount: '12.5', currency: 'TWD' } });
  });
  it('derives audit keys and detects zero ids', () => {
    expect(auditActionKey('batch.auto_transition')).toBe('timeline.actions.batch_auto_transition');
    expect(isZeroId('000000000000000000000000')).toBe(true);
    expect(isZeroId('65a1b2c3d4e5f60718293a4b')).toBe(false);
  });
});

describe('canMarkUnpurchasable', () => {
  const confirmed = batch({ status: 'purchasing', reviewConfirmation: { by: 'a1', at: '', purchaseOutside: false } });
  const approved = item({ status: 'approved', unpurchasable: null });
  const buyer = () => caller({ isPurchaser: true });
  it('is offered to purchasers (a global role) on unmarked approved items of a confirmed batch', () => {
    expect(canMarkUnpurchasable(approved, confirmed, buyer())).toBe(true);
    expect(canUndoUnpurchasable(item({ status: 'approved', unpurchasable: { by: 'x', at: '', reason: 'r' } }), confirmed, buyer())).toBe(true);
  });
  it('is hidden from team admins, members and system admins without the purchaser role', () => {
    expect(canMarkUnpurchasable(approved, confirmed, caller({ teamRole: 'admin' }))).toBe(false);
    expect(canMarkUnpurchasable(approved, confirmed, caller({ isSystemAdmin: true, teamRole: undefined }))).toBe(false);
  });
  it('requires a confirmed batch that is not bought outside, an approved unmarked item and a live team', () => {
    expect(canMarkUnpurchasable(item({ status: 'pending' }), confirmed, buyer())).toBe(false);
    expect(canMarkUnpurchasable(approved, batch({ status: 'reviewing' }), buyer())).toBe(false);
    expect(canMarkUnpurchasable(approved, { ...confirmed, reviewConfirmation: { by: 'a1', at: '', purchaseOutside: true } }, buyer())).toBe(false);
    expect(canMarkUnpurchasable(approved, confirmed, { ...buyer(), archived: true })).toBe(false);
  });
});
