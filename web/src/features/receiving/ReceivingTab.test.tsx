import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ItemException } from '../../api/types';
import i18n from '../../i18n';
import { batch, item, renderWithApi, type Routes } from '../../test/fakeApi';
import { callerFor } from '../batches/rules';
import { ReceivingTab } from './ReceivingTab';
import { chooseMenuItem, openRowMenu, rowWith, selectionBar } from '../../test/dataTable';

beforeAll(() => {
  void i18n.changeLanguage('en');
});
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const meta = { version: '1', commit: 'unknown', baseCurrency: 'TWD', supportedCurrencies: ['TWD'], lookupEnabled: false, emailEnabled: false };
const exception = (over: Partial<ItemException> = {}): ItemException => ({
  id: 'e1', itemId: 'i3', teamId: 't1', type: 'damaged', description: 'Cracked housing', reportedBy: 'u1', reportedAt: at, resolution: null,
  createdAt: at, updatedAt: at, version: 4, ...over,
});
const items = [
  item(1, { name: 'Servo', status: 'ordered', quantity: 4, receivedQuantity: 0, version: 7 }),
  item(2, { name: 'Wheel', status: 'partially_received', quantity: 5, receivedQuantity: 2 }),
  item(3, { name: 'Gear', status: 'exception', quantity: 2, receivedQuantity: 1 }),
  item(4, { name: 'Bolt', status: 'received', quantity: 10, receivedQuantity: 10 }),
  item(5, { name: 'Nut', status: 'not_obtained', closeReason: 'Out of stock' }),
];
const caller = (userId = 'u1', role: 'admin' | 'member' = 'member') =>
  callerFor({ id: userId, isSystemAdmin: false, memberships: [{ teamId: 't1', role }] as never }, 't1');

function show(routes: Routes = {}, c = caller(), b = batch({ status: 'receiving', assignments: { approvers: [], purchasers: ['p1'], receivers: ['u1'] } })) {
  return renderWithApi(
    <MemoryRouter>
      <ReceivingTab batch={b} caller={c} items={items} nameOf={() => 'Alice'} bulkReceive />
    </MemoryRouter>,
    { 'GET /meta': meta, 'GET /items/i3/exceptions': { items: [exception()] }, 'GET /items/i1/receipts': { items: [] }, ...routes },
  );
}

describe('ReceivingTab', () => {
  it('groups items into tables: open exceptions, to receive, closed', async () => {
    show();
    expect(await screen.findByText('Cracked housing')).toBeTruthy();
    expect(screen.getByText('Open exceptions')).toBeTruthy();
    expect(screen.getByText('To receive')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(within(rowWith('Wheel')).getByText('2 of 5')).toBeTruthy();
    expect(within(rowWith('Nut')).getByText('Out of stock')).toBeTruthy();
    expect(screen.getAllByRole('table').map((t) => t.getAttribute('aria-label'))).toEqual(['Open exceptions', 'To receive', 'Closed']);
  });

  it('records a receipt with the item version in If-Match', async () => {
    const { calls } = show({ 'POST /items/i1/receipts': (b: unknown) => ({ receipt: b, item: items[0], batch: batch() }) });
    await screen.findByText('Servo');
    expect(await openRowMenu(rowWith('Servo'))).toEqual(['Receive (4 left)', 'Report a problem']);
    await chooseMenuItem('Receive (4 left)');
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText('Quantity received now') as HTMLInputElement;
    expect(qty.value).toBe('4');
    fireEvent.change(qty, { target: { value: '5' } });
    fireEvent.blur(qty);
    expect(within(dialog).getByText('That is more than the 4 still to arrive.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Record receipt' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(qty, { target: { value: '3' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ quantity: 3 }));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/items/i1/receipts');
    expect(post?.headers['If-Match']).toBe('"7"');
  });

  it('reports a problem with a type and description', async () => {
    const { calls } = show({ 'POST /items/i1/exceptions': (b: unknown) => ({ exception: b, item: items[0], batch: batch(), adjustment: null }) });
    await screen.findByText('Servo');
    await openRowMenu(rowWith('Servo'));
    await chooseMenuItem('Report a problem');
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Report problem' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('What is wrong?'), { target: { value: 'wrong_item' } });
    fireEvent.change(within(dialog).getByLabelText('Describe the problem'), { target: { value: 'Blue instead of red' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Report problem' })); });
    await waitFor(() => expect(calls.find((c) => c.path === '/items/i1/exceptions' && c.method === 'POST')?.body).toEqual({ type: 'wrong_item', description: 'Blue instead of red' }));
  });

  it('lets a purchaser resolve an exception with the exception version in If-Match', async () => {
    const { calls } = show({ 'POST /exceptions/e1/resolve': (b: unknown) => ({ exception: b, item: items[2], batch: batch(), adjustment: null }) }, caller('p1'));
    await screen.findByText('Cracked housing');
    expect(await openRowMenu(rowWith('Gear'))).toEqual(['Resolve']);
    await chooseMenuItem('Resolve');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Disposition'), { target: { value: 'accept' } });
    expect((within(dialog).getByRole('button', { name: 'Resolve' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Good enough' } });
    fireEvent.change(within(dialog).getByLabelText(/^Refund/), { target: { value: '15' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' })); });
    await waitFor(() => expect(calls.find((c) => c.path === '/exceptions/e1/resolve')?.body).toEqual({ action: 'accept', note: 'Good enough', refundAmountBase: '15' }));
    expect(calls.find((c) => c.path === '/exceptions/e1/resolve')?.headers['If-Match']).toBe('"4"');
  });

  it('a receiver can receive but not resolve', async () => {
    show();
    await screen.findByText('Cracked housing');
    expect(within(rowWith('Gear')).queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(within(rowWith('Servo')).getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(within(rowWith('Wheel')).getByRole('checkbox', { name: 'Select row' })).toBeTruthy();
  });

  it('offers no picking unless config.json turns on bulkReceive', async () => {
    renderWithApi(
      <MemoryRouter>
        <ReceivingTab batch={batch({ status: 'receiving', assignments: { approvers: [], purchasers: ['p1'], receivers: ['u1'] } })} caller={caller()} items={items} nameOf={() => 'Alice'} />
      </MemoryRouter>,
      { 'GET /meta': meta, 'GET /items/i3/exceptions': { items: [exception()] }, 'GET /items/i1/receipts': { items: [] } },
    );
    await screen.findByText('Cracked housing');
    expect(screen.queryByRole('checkbox', { name: 'Select row' })).toBeNull();
  });

  it('receives the picked items in full, one receipt each with its version', async () => {
    const { calls } = show({
      'POST /items/i1/receipts': (b: unknown) => ({ receipt: b, item: items[0], batch: batch() }),
      'POST /items/i2/receipts': (b: unknown) => ({ receipt: b, item: items[1], batch: batch() }),
    });
    await screen.findByText('Servo');
    expect(selectionBar()).toBeNull();
    await act(async () => { fireEvent.click(within(rowWith('Servo')).getByRole('checkbox', { name: 'Select row' })); });
    await act(async () => { fireEvent.click(within(rowWith('Wheel')).getByRole('checkbox', { name: 'Select row' })); });
    await act(async () => { fireEvent.click(within(selectionBar()!).getByRole('button', { name: 'Receive in full' })); });
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body, c.headers['If-Match']])).toEqual([
      ['/items/i1/receipts', { quantity: 4 }, '"7"'],
      ['/items/i2/receipts', { quantity: 3 }, '"1"'],
    ]));
  });

  it('is read-only for a member with no receiving role or once the batch is completed', async () => {
    show({}, caller('u9'));
    await screen.findByText('Cracked housing');
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    cleanup();
    show({}, caller('p1'), batch({ status: 'completed', assignments: { approvers: [], purchasers: ['p1'], receivers: [] } }));
    await screen.findByText('Cracked housing');
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
