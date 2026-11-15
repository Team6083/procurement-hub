import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes as RouterRoutes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Order } from '../api/types';
import i18n from '../i18n';
import { apiError, batch, item, me, renderWithApi, type Routes } from '../test/fakeApi';
import { PlaceOrdersPage } from './PlaceOrdersPage';
import { selectionBar } from '../test/dataTable';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const order = (id: string, batchId: string, teamId: string, number: number, over: Partial<Order> = {}): Order => ({
  id, teamId, batchId, number, vendor: 'Acme', itemIds: ['i1'], vendorTransactionId: null, status: 'draft',
  itemsCostBase: '0', sharedCostBase: '0', adjustmentsBase: '0', totalBase: '100', costsProvisional: true, createdBy: 'u1', createdAt: at, updatedAt: at, version: 1, ...over,
});
const mem = (teamId: string) => ({ teamId, slug: teamId, name: teamId, role: 'member' as const, ssoRole: '' as const, manualRole: 'member' as const, defaultSubgroupId: '' });
const assign = (purchasers: string[]) => ({ approvers: [], purchasers, receivers: [] });
const b1 = batch({ id: 'b1', teamId: 't1', number: 1, title: 'Alpha', status: 'ordering', assignments: assign(['u1']) });
const b2 = batch({ id: 'b2', teamId: 't2', number: 2, title: 'Beta', status: 'ordering', assignments: assign(['u1']) });
const b3 = batch({ id: 'b3', teamId: 't1', number: 3, title: 'Gamma', status: 'ordering', assignments: assign(['u9']) });

const routes = (extra: Routes = {}): Routes => ({
  'GET /meta': { version: '1', commit: 'unknown', baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled: false, emailEnabled: false },
  'GET /me': me({ memberships: [mem('t1'), mem('t2')] }),
  'GET /teams': { items: [{ id: 't1', slug: 't1', name: 'Robotics', description: '', archived: false }, { id: 't2', slug: 't2', name: 'Vision', description: '', archived: false }], nextCursor: null },
  'GET /batches': { items: [b1, b2, b3], nextCursor: null },
  'GET /batches/b1/orders': { items: [order('o1', 'b1', 't1', 1), order('o9', 'b1', 't1', 2, { status: 'placed', vendorTransactionId: 'vP' })] },
  'GET /batches/b2/orders': { items: [order('o2', 'b2', 't2', 1)] },
  'GET /batches/b3/orders': { items: [order('o3', 'b3', 't1', 1)] },
  'GET /batches/b1/items': { items: [item(1, { id: 'a1', name: 'Servo', status: 'approved' }), item(2, { id: 'a2', name: 'Cable', status: 'approved', vendor: 'Zed' }), item(3, { id: 'i1', name: 'Done', status: 'approved', orderId: 'o1' })], nextCursor: null },
  'GET /batches/b2/items': { items: [item(1, { id: 'c1', name: 'Lens', batchId: 'b2', teamId: 't2', status: 'approved' }), item(2, { id: 'c2', name: 'Pending thing', batchId: 'b2', teamId: 't2' })], nextCursor: null },
  'GET /batches/b3/items': { items: [item(1, { id: 'd1', name: 'Locked', batchId: 'b3', status: 'approved' })], nextCursor: null },
  ...extra,
});

function show(r: Routes) {
  return renderWithApi(
    <MemoryRouter initialEntries={['/orders']}>
      <RouterRoutes>
        <Route path="/orders" element={<PlaceOrdersPage />} />
        <Route path="/vendor-transactions/:id" element={<p>vt page</p>} />
      </RouterRoutes>
    </MemoryRouter>,
    r,
  );
}

const click = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const table = (name: string) => within(screen.getByRole('table', { name }));
/** The checkbox of the row in `tableName` that shows `text`. */
const rowBox = (tableName: string, text: string) => within(table(tableName).getAllByRole('row').find((r) => r.textContent?.includes(text))!).queryByRole('checkbox');
/** The SelectionBar's main action, with the count of picked rows. */
async function createFromBar(count: number) {
  const bar = selectionBar()!;
  expect(within(bar).getByText(`${count} selected`)).toBeTruthy();
  await click(within(bar).getByRole('button', { name: 'Create external order' }));
}
const posts = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

describe('PlaceOrdersPage', () => {
  it('orders approved items of two batches and teams together, without drafts and without a vendor order number', async () => {
    let n = 0;
    const { calls } = show(routes({
      'GET /batches/b1/orders': { items: [] }, 'GET /batches/b2/orders': { items: [] }, 'GET /batches/b3/orders': { items: [] },
      'POST /batches/b1/orders': (b: unknown) => ({ ...order(`n${++n}`, 'b1', 't1', 1), ...(b as object) }),
      'POST /batches/b2/orders': (b: unknown) => ({ ...order(`n${++n}`, 'b2', 't2', 1), ...(b as object) }),
      'POST /vendor-transactions': (b: unknown) => ({ id: 'vNew', ...(b as object), batchIds: ['b1', 'b2'] }),
    }));
    await screen.findByText('Servo');
    expect(screen.queryByText('Nothing to order')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText('Pending thing')).toBeNull();
    await click(rowBox('Ready to order', 'Servo')!);
    await click(rowBox('Ready to order', 'Lens')!);
    await createFromBar(2);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Vendor order number')).toBeNull();
    await click(within(dialog).getByRole('button', { name: 'Create external order' }));
    expect(await screen.findByText('vt page')).toBeTruthy();
    expect(posts(calls, '/batches/b1/orders').map((c) => c.body)).toEqual([{ vendor: 'Acme', itemIds: ['a1'] }]);
    expect(posts(calls, '/batches/b2/orders').map((c) => c.body)).toEqual([{ vendor: 'Acme', itemIds: ['c1'] }]);
    expect(posts(calls, '/vendor-transactions').map((c) => c.body)).toEqual([{ orderIds: ['n1', 'n2'], currency: 'USD', vendor: 'Acme' }]);
  });

  it('keeps created orders when a later step fails and a retry only creates the missing ones', async () => {
    let n = 0;
    let b2Calls = 0;
    const { calls } = show(routes({
      'GET /batches/b1/orders': { items: [] }, 'GET /batches/b2/orders': { items: [] },
      'POST /batches/b1/orders': (b: unknown) => ({ ...order(`n${++n}`, 'b1', 't1', 1), ...(b as object) }),
      'POST /batches/b2/orders': (b: unknown) => (++b2Calls === 1 ? apiError(400, 'validation_failed') : { ...order(`n${++n}`, 'b2', 't2', 1), ...(b as object) }),
      'POST /vendor-transactions': (b: unknown) => ({ id: 'vNew', ...(b as object), batchIds: ['b1', 'b2'] }),
    }));
    await screen.findByText('Servo');
    await click(rowBox('Ready to order', 'Servo')!);
    await click(rowBox('Ready to order', 'Lens')!);
    await createFromBar(2);
    const dialog = await screen.findByRole('dialog');
    await click(within(dialog).getByRole('button', { name: 'Create external order' }));
    await within(dialog).findByText(/1 draft orders were already created/);
    expect(posts(calls, '/vendor-transactions')).toHaveLength(0);
    await click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('vt page')).toBeTruthy();
    expect(posts(calls, '/batches/b1/orders')).toHaveLength(1);
    expect(posts(calls, '/batches/b2/orders')).toHaveLength(2);
    expect(posts(calls, '/vendor-transactions').map((c) => c.body)).toEqual([{ orderIds: ['n1', 'n2'], currency: 'USD', vendor: 'Acme' }]);
  });

  it('shows the items of purchasable batches as selectable and others disabled', async () => {
    show(routes({ 'GET /batches/b1/orders': { items: [] }, 'GET /batches/b2/orders': { items: [] }, 'GET /batches/b3/orders': { items: [] } }));
    await screen.findByText('Locked');
    // Nothing to act on before rows are picked.
    expect(selectionBar()).toBeNull();
    expect(rowBox('Ready to order', 'Locked')).toBeNull();
    expect(rowBox('Ready to order', 'Servo')).toBeTruthy();
    expect(screen.getAllByText('Only purchasers of the batch can order it.').length).toBeGreaterThan(0);
    // The vendor group's checkbox picks every pickable row of the group.
    await click(table('Ready to order').getAllByRole('checkbox', { name: 'Select all' })[1]!);
    expect(within(selectionBar()!).getByText('2 selected')).toBeTruthy();
  });

  it('creates one external order from orders of two batches, without a vendor order number', async () => {
    const { calls } = show(routes({ 'POST /vendor-transactions': (b: unknown) => ({ id: 'vNew', ...(b as object), batchIds: ['b1', 'b2'] }) }));
    await screen.findByText('Draft orders');
    const boxes = table('Draft orders').getAllByRole('checkbox', { name: 'Select row' });
    // rows: Acme/b1, Acme/b2 (Acme/b3 cannot be picked) in batch order
    await click(boxes[0]!);
    await click(boxes[1]!);
    await createFromBar(2);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Vendor order number')).toBeNull();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create external order' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ orderIds: ['o1', 'o2'], currency: 'USD', vendor: 'Acme' }));
    expect(await screen.findByText('vt page')).toBeTruthy();
  });

  it('does not let a non-purchaser batch be selected', async () => {
    show(routes());
    await screen.findByText('Draft orders');
    expect(table('Draft orders').getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);
    // The table's and the Acme group's "Select all" pick only the two pickable drafts.
    await click(table('Draft orders').getAllByRole('checkbox', { name: 'Select all' })[1]!);
    expect(within(selectionBar()!).getByText('2 selected')).toBeTruthy();
  });

  it('lists external orders in progress with links', async () => {
    show(routes());
    const link = await screen.findByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/vendor-transactions/vP');
  });

  it('shows an empty state when nothing is ready', async () => {
    show(routes({ 'GET /batches': { items: [], nextCursor: null } }));
    expect(await screen.findByText('Nothing to order')).toBeTruthy();
  });
});
