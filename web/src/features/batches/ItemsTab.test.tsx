import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, item, renderWithApi, team } from '../../test/fakeApi';
import { chooseMenuItem, closeMenu, filterSelect, openRowMenu, rowWith, selectionBar } from '../../test/dataTable';
import { ItemsTab } from './ItemsTab';
import { callerFor } from './rules';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const ordering = batch({ status: 'purchasing', assignments: { approvers: [], purchasers: ['u1'] }, reviewConfirmation: { by: 'u1', at: '2026-01-01T00:00:00Z', purchaseOutside: false } });
const items = [item(1, { name: 'Wheel', status: 'approved', version: 4, toPurchaseQuantity: 1 }), item(2, { name: 'Gear', status: 'approved', unpurchasable: { by: 'u1', at: '2026-01-01T00:00:00Z', reason: 'x' } }), item(3, { name: 'Old', status: 'rejected' })];
const caller = (role: 'admin' | 'member' = 'member', userId = 'u1') =>
  callerFor({ id: userId, isSystemAdmin: false, isPurchaser: userId === 'u1', isReceiver: false, memberships: [{ teamId: 't1', role }] as never }, 't1');

function show(c = caller(), b = ordering, routes = {}) {
  return renderWithApi(<ItemsTab batch={b} team={team()} caller={c} items={items} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, routes);
}

describe('ItemsTab unpurchasable action', () => {
  it('offers mark on unmarked approved items and undo on marked ones, in the row menu', async () => {
    show();
    fireEvent.change(await filterSelect('Status'), { target: { value: '' } });
    // The rejected row has no action.
    expect(screen.getAllByRole('button', { name: 'More actions' })).toHaveLength(2);
    expect(await openRowMenu(rowWith('Wheel'))).toEqual(['Mark unpurchasable']);
    await closeMenu();
    expect(await openRowMenu(rowWith('Gear'))).toEqual(['Undo unpurchasable']);
    await closeMenu();
  });
  it('hides the action from non-purchasers and before the review is confirmed', () => {
    show(caller('member', 'someone'));
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    cleanup();
    show(caller(), batch({ ...ordering, status: 'reviewing', reviewConfirmation: null }));
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
  it('posts the reason with the item version in If-Match', async () => {
    const { calls } = show(caller(), ordering, { 'POST /items/i1/unpurchasable': item(1, { status: 'approved', version: 5 }) });
    await openRowMenu(rowWith('Wheel'));
    await chooseMenuItem('Mark unpurchasable');
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark unpurchasable' });
    await act(async () => { fireEvent.click(confirm); });
    expect(await within(dialog).findByText('This field is required.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Discontinued' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/items/i1/unpurchasable')).toBe(true));
    const call = calls.find((c) => c.path === '/items/i1/unpurchasable')!;
    expect(call.body).toEqual({ reason: 'Discontinued' });
    expect(JSON.stringify(call.headers)).toContain('4');
  });
});

const reviewing = batch({ status: 'reviewing', assignments: { approvers: ['u1'], purchasers: [] } });
const reviewItems = [
  item(1, { name: 'Servo', status: 'pending' }),
  item(2, { name: 'Cable', status: 'pending' }),
  item(3, { name: 'Gear', status: 'returned' }),
  item(4, { name: 'Wheel', status: 'approved' }),
];
const showReview = (c = caller(), routes = {}) =>
  renderWithApi(<ItemsTab batch={reviewing} team={team()} caller={c} items={reviewItems} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, routes);
const statusFilter = () => filterSelect('Status');

describe('ItemsTab review workspace', () => {
  it('defaults an approver to pending items and lets the filter widen to all', async () => {
    showReview();
    // The preset status shows as a set filter, so the list never looks complete.
    expect(screen.getByRole('button', { name: /^Filter\s*1$/ })).toBeTruthy();
    expect((await statusFilter()).value).toBe('pending');
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);
    fireEvent.change(await statusFilter(), { target: { value: '' } });
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(4);
  });

  it('does not preselect a filter for a member who cannot review, and hides the decisions', async () => {
    showReview(caller('member', 'someone'));
    expect((await statusFilter()).value).toBe('');
    expect(screen.getByText('Only approvers and team admins can review items.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!); });
    expect(selectionBar()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve selected/ })).toBeNull();
  });

  it('approves only the selected pending items', async () => {
    const { calls } = showReview(caller(), { 'POST /batches/b1/reviews': { batch: reviewing } });
    // No decision buttons wait above or below the table before anything is picked.
    expect(screen.queryByRole('button', { name: /^Approve selected/ })).toBeNull();
    fireEvent.change(await statusFilter(), { target: { value: '' } });
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await act(async () => { fireEvent.click(boxes[0]!); });
    await act(async () => { fireEvent.click(boxes[2]!); }); // returned: not decidable
    expect(screen.getByRole('button', { name: 'Approve selected (1)' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decisions: [{ itemId: 'i1', decision: 'approve' }] }));
  });

  it('returns the selection with a required comment', async () => {
    const { calls } = showReview(caller(), { 'POST /batches/b1/reviews': { batch: reviewing } });
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Return' })); });
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Return' })); });
    expect(await within(dialog).findByText('This field is required.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Comment/), { target: { value: 'Which model?' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Return' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decisions: [{ itemId: 'i1', decision: 'return', comment: 'Which model?' }] }));
  });

  it('offers force reject only to team admins on pending and returned items', async () => {
    showReview(caller('member'));
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    cleanup();
    const { calls } = showReview(caller('admin'), { 'POST /items/i1/force-reject': item(1, { status: 'rejected' }) });
    fireEvent.change(await statusFilter(), { target: { value: '' } });
    for (const name of ['Servo', 'Cable', 'Gear']) {
      expect(await openRowMenu(rowWith(name))).toContain('Force reject');
      await closeMenu();
    }
    expect(within(rowWith('Wheel')).queryByRole('button', { name: 'More actions' })).toBeNull();
    await openRowMenu(rowWith('Servo'));
    await chooseMenuItem('Force reject');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Duplicate' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Force reject' })); });
    await waitFor(() => expect(calls.find((c) => c.path === '/items/i1/force-reject')?.body).toEqual({ reason: 'Duplicate' }));
  });
});
