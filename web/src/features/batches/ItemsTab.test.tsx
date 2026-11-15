import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, item, renderWithApi, team } from '../../test/fakeApi';
import { ItemsTab } from './ItemsTab';
import { callerFor } from './rules';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const ordering = batch({ status: 'ordering', assignments: { approvers: [], purchasers: ['u1'], receivers: [] } });
const items = [item(1, { name: 'Wheel', status: 'approved', version: 4 }), item(2, { name: 'Gear', status: 'approved', orderId: 'o1' }), item(3, { name: 'Old', status: 'unpurchasable' })];
const caller = (role: 'admin' | 'member' = 'member', userId = 'u1') =>
  callerFor({ id: userId, isSystemAdmin: false, memberships: [{ teamId: 't1', role }] as never }, 't1');

function show(c = caller(), b = ordering, routes = {}) {
  return renderWithApi(<ItemsTab batch={b} team={team()} caller={c} items={items} nameOf={() => 'Alice'} defaultSubgroupId="g1" />, routes);
}

describe('ItemsTab unpurchasable action', () => {
  it('offers the action only on approved items outside an order, and shows the unpurchasable status', () => {
    show();
    expect(screen.getAllByRole('button', { name: 'Mark unpurchasable' })).toHaveLength(1);
    expect(screen.getAllByText('Unpurchasable').length).toBeGreaterThan(0);
  });
  it('hides the action from non-purchasers and outside ordering', () => {
    show(caller('member', 'someone'));
    expect(screen.queryByRole('button', { name: 'Mark unpurchasable' })).toBeNull();
    cleanup();
    show(caller(), batch({ ...ordering, status: 'receiving' }));
    expect(screen.queryByRole('button', { name: 'Mark unpurchasable' })).toBeNull();
  });
  it('posts the reason with the item version in If-Match', async () => {
    const { calls } = show(caller(), ordering, { 'POST /items/i1/unpurchasable': item(1, { status: 'unpurchasable', version: 5 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Mark unpurchasable' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark unpurchasable' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Discontinued' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/items/i1/unpurchasable')).toBe(true));
    const call = calls.find((c) => c.path === '/items/i1/unpurchasable')!;
    expect(call.body).toEqual({ reason: 'Discontinued' });
    expect(JSON.stringify(call.headers)).toContain('4');
  });
});
