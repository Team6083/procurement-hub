import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, item, renderWithApi, team } from '../../test/fakeApi';
import { chooseMenuItem, closeMenu, openRowMenu, rowWith, selectionBar } from '../../test/dataTable';
import { ItemsTab } from './ItemsTab';
import { callerFor } from './rules';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

/** Opens the FilterBar popover if closed and returns the Status checkboxes by label. */
async function statusChecks() {
  if (!screen.queryByRole('group', { name: 'Status' })) {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Filter/ })); });
  }
  const group = screen.getByRole('group', { name: 'Status' });
  return {
    checked: () => within(group).queryAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).map((c) => c.closest('label')?.textContent),
    toggle: async (label: string) => { await act(async () => { fireEvent.click(within(group).getByRole('checkbox', { name: label })); }); },
  };
}
/** Unchecks every ticked status, i.e. shows all. */
async function showAllStatuses() {
  const s = await statusChecks();
  for (const l of s.checked()) await s.toggle(l!);
}

const ordering = batch({ status: 'purchasing', assignments: { approvers: [], purchasers: ['u1'] }, reviewConfirmation: { by: 'u1', at: '2026-01-01T00:00:00Z', purchaseOutside: false } });
const items = [item(1, { name: 'Wheel', status: 'approved', version: 4, toPurchaseQuantity: 1 }), item(2, { name: 'Gear', status: 'approved', unpurchasable: { by: 'u1', at: '2026-01-01T00:00:00Z', reason: 'x' } }), item(3, { name: 'Old', status: 'rejected' })];
const caller = (role: 'admin' | 'member' = 'member', userId = 'u1') =>
  callerFor({ id: userId, isSystemAdmin: false, isPurchaser: userId === 'u1', isReceiver: false, memberships: [{ teamId: 't1', role }] as never }, 't1');

function show(c = caller(), b = ordering, routes = {}) {
  return renderWithApi(<ItemsTab batch={b} team={team()} caller={c} items={items} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, routes);
}

describe('ItemsTab status filter', () => {
  it('does not apply the to-purchase default when nothing is left to purchase, so the select and the list agree', async () => {
    const bought = [item(1, { name: 'Wheel', status: 'approved', toPurchaseQuantity: 0 }), item(2, { name: 'Old', status: 'rejected' })];
    renderWithApi(<ItemsTab batch={ordering} team={team()} caller={caller()} items={bought} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, {});
    expect((await statusChecks()).checked()).toEqual([]);
    expect(rowWith('Wheel')).toBeTruthy();
    expect(rowWith('Old')).toBeTruthy();
  });
});

describe('ItemsTab unpurchasable action', () => {
  it('offers mark on unmarked approved items and undo on marked ones, in the row menu', async () => {
    show();
    await showAllStatuses();
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

describe('ItemsTab review workspace', () => {
  it('defaults a reviewer to pending and returned items and lets single statuses be unchecked', async () => {
    showReview();
    expect((await statusChecks()).checked()).toEqual(['Pending', 'Returned']);
    expect(rowWith('Gear')).toBeTruthy();
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(3);
    await (await statusChecks()).toggle('Returned');
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);
  });

  it('defaults an approver to pending items and lets the filter widen to all', async () => {
    showReview();
    // The preset status shows as a set filter, so the list never looks complete.
    expect(screen.getByRole('button', { name: /^Filter\s*1$/ })).toBeTruthy();
    expect((await statusChecks()).checked()).toEqual(['Pending', 'Returned']);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(3);
    await showAllStatuses();
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(4);
  });

  it('does not preselect a filter for a member who cannot review, and hides the decisions', async () => {
    showReview(caller('member', 'someone'));
    expect((await statusChecks()).checked()).toEqual([]);
    expect(screen.getByText('Only approvers and team admins can review items.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!); });
    expect(selectionBar()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve selected/ })).toBeNull();
  });

  it('approves only the selected pending items', async () => {
    const { calls } = showReview(caller(), { 'POST /batches/b1/reviews': { batch: reviewing } });
    // No decision buttons wait above or below the table before anything is picked.
    expect(screen.queryByRole('button', { name: /^Approve selected/ })).toBeNull();
    await showAllStatuses();
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

  it('offers return and reject on pending items and force reject on returned ones, to reviewers only', async () => {
    // An assigned approver who is no admin decides on pending items but cannot force-reject returned ones.
    showReview(caller('member'));
    await showAllStatuses();
    expect((await openRowMenu(rowWith('Servo'))).some((l) => l.startsWith('Reject'))).toBe(true);
    await closeMenu();
    expect((await openRowMenu(rowWith('Gear'))).some((l) => l.startsWith('Force reject'))).toBe(false);
    await closeMenu();
    cleanup();
    const { calls } = showReview(caller('admin'), { 'POST /items/i3/force-reject': item(3, { status: 'rejected' }) });
    await showAllStatuses();
    for (const name of ['Servo', 'Cable']) {
      const labels = await openRowMenu(rowWith(name));
      expect(labels[0]).toMatch(/^Approve/);
      expect(labels.some((l) => l.startsWith('Return'))).toBe(true);
      expect(labels.some((l) => l.startsWith('Reject'))).toBe(true);
      expect(labels.some((l) => l.startsWith('Force reject'))).toBe(false);
      await closeMenu();
    }
    expect(within(rowWith('Wheel')).queryByRole('button', { name: 'More actions' })).toBeNull();
    expect((await openRowMenu(rowWith('Gear'))).some((l) => l.startsWith('Force reject'))).toBe(true);
    await chooseMenuItem(/^Force reject/);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Duplicate' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Force reject' })); });
    await waitFor(() => expect(calls.find((c) => c.path === '/items/i3/force-reject')?.body).toEqual({ reason: 'Duplicate' }));
  });

  it('approves a pending item straight from its row menu', async () => {
    const { calls } = showReview(caller('admin'), { 'POST /batches/b1/reviews': { batch: reviewing } });
    await showAllStatuses();
    await openRowMenu(rowWith('Servo'));
    await chooseMenuItem(/^Approve/);
    await waitFor(() => expect(calls.find((c) => c.path === '/batches/b1/reviews')?.body).toEqual({ decisions: [{ itemId: 'i1', decision: 'approve' }] }));
  });

  it('shows the review status as an icon once purchasing has a fulfillment status', () => {
    renderWithApi(<ItemsTab batch={ordering} team={team()} caller={caller()} items={[item(1, { name: 'Wheel', status: 'approved', fulfillment: 'ordered', toPurchaseQuantity: 1 })]} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, {});
    expect(screen.getByLabelText('Approved')).toBeTruthy();
    expect(screen.queryAllByText('Approved').filter((e) => e.closest('[data-scope="badge"]'))).toHaveLength(0);
  });
});
