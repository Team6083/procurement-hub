import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Order } from '../../api/types';
import i18n from '../../i18n';
import { batch, item, renderWithApi, team, type Routes } from '../../test/fakeApi';
import { callerFor } from '../batches/rules';
import { OrdersTab } from './OrdersTab';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const order = (number: number, over: Partial<Order> = {}): Order => ({
  id: `o${number}`, teamId: 't1', batchId: 'b1', number, vendor: 'Acme', itemIds: ['i1'], vendorTransactionId: null, status: 'draft',
  itemsCostBase: '0', sharedCostBase: '0', adjustmentsBase: '0', totalBase: '0', costsProvisional: true, createdBy: 'u1', createdAt: at, updatedAt: at, version: 1, ...over,
});

const meta = { version: '1', commit: 'unknown', baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled: false, emailEnabled: false };
const items = [
  item(1, { name: 'Servo', status: 'ordered', orderId: 'o1', vendor: 'Acme' }),
  item(2, { name: 'Wheel', status: 'approved', vendor: 'Acme' }),
  item(3, { name: 'Gear', status: 'approved', vendor: 'Acme' }),
  item(4, { name: 'Pending thing', status: 'pending' }),
];
const caller = (userId = 'u1', teamRole: 'admin' | 'member' = 'member') => ({ ...callerFor({ id: userId, isSystemAdmin: false, memberships: [{ teamId: 't1', role: teamRole }] as never }, 't1') });

function show(routes: Routes, c = caller(), b = batch({ status: 'ordering', assignments: { approvers: [], purchasers: ['u1'], receivers: [] } })) {
  return renderWithApi(
    <MemoryRouter>
      <OrdersTab batch={b} team={team()} caller={c} items={items} nameOf={() => 'Alice'} />
    </MemoryRouter>,
    { 'GET /meta': meta, 'GET /batches/b1/orders': { items: [order(1, { status: 'placed', vendorTransactionId: 'v1', itemsCostBase: '320', totalBase: '350.50' }), order(2, { itemIds: ['i2'] })] }, ...routes },
  );
}

describe('OrdersTab', () => {
  it('lists orders with status and cost, and links the external order', async () => {
    show({});
    const rows = await screen.findAllByRole('row');
    const first = within(rows[1]!);
    expect(first.getByText('#1')).toBeTruthy();
    expect(first.getByText('Placed')).toBeTruthy();
    expect(first.getByText('350.50')).toBeTruthy();
    expect(first.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/vendor-transactions/v1');
    expect(first.getByText(/Servo/)).toBeTruthy();
    expect(within(rows[2]!).getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Total of active orders: 350.50 TWD')).toBeTruthy();
    // only approved items outside any order can be picked for a new order
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);
  });

  it('creates an order from the selected approved items with their common vendor', async () => {
    const { calls } = show({ 'POST /batches/b1/orders': (b: unknown) => ({ ...order(3), ...(b as object) }) });
    const boxes = await screen.findAllByRole('checkbox', { name: 'Select row' });
    await act(async () => { fireEvent.click(boxes[0]!); });
    await act(async () => { fireEvent.click(boxes[1]!); });
    expect((screen.getByRole('textbox', { name: 'Vendor' }) as HTMLInputElement).value).toBe('Acme');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create order from 2 items' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ vendor: 'Acme', itemIds: ['i2', 'i3'] }));
  });

  it('offers edit and cancel only for a free draft, adjust only for a placed order', async () => {
    show({});
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(rows[1]!).getByRole('button', { name: 'Adjust' })).toBeTruthy();
    expect(within(rows[2]!).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(rows[2]!).getByRole('button', { name: 'Cancel order' })).toBeTruthy();
    expect(within(rows[2]!).queryByRole('button', { name: 'Adjust' })).toBeNull();
  });

  it('books an adjustment with the order version in If-Match', async () => {
    const { calls } = show({ 'POST /orders/o1/adjustments': (b: unknown) => ({ adjustment: b, order: order(1) }) });
    const rows = await screen.findAllByRole('row');
    await act(async () => { fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Adjust' })); });
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Book adjustment' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: '-20' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Refund for a broken part' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Book adjustment' })); });
    await waitFor(() => expect(calls.find((c) => c.path === '/orders/o1/adjustments')?.body).toEqual({ amountBase: '-20', reason: 'Refund for a broken part' }));
    expect(calls.find((c) => c.path === '/orders/o1/adjustments')?.headers['If-Match']).toBe('"1"');
  });

  it('is read-only for a member who is not a purchaser', async () => {
    show({}, caller('u9'));
    await screen.findAllByRole('row');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create external order/ })).toBeNull();
    expect(screen.queryByText('Approved items to order')).toBeNull();
  });

  it('shows an empty state when there are no orders', async () => {
    show({ 'GET /batches/b1/orders': { items: [] } });
    expect(await screen.findByText('No orders yet')).toBeTruthy();
  });
});
