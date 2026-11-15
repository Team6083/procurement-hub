import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes as RouterRoutes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrderDetail, VendorTransactionView } from '../api/types';
import i18n from '../i18n';
import { batch, item, me, renderWithApi, type Routes } from '../test/fakeApi';
import { VendorTransactionPage } from './VendorTransactionPage';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const detail = (n: number, itemIds: number[]): OrderDetail => ({
  order: {
    id: `o${n}`, teamId: 't1', batchId: 'b1', number: n, vendor: 'Acme', itemIds: itemIds.map((i) => `i${i}`), vendorTransactionId: 'v1', status: 'draft',
    itemsCostBase: '100', sharedCostBase: '10', adjustmentsBase: '0', totalBase: '110', costsProvisional: true, createdBy: 'u1', createdAt: at, updatedAt: at, version: 1,
  },
  items: itemIds.map((i) => item(i, { name: `Part ${i}`, status: 'approved', quantity: 2, actualUnitPrice: null })),
});

const view = (over: Partial<VendorTransactionView> = {}): VendorTransactionView => ({
  id: 'v1', vendor: 'Acme', externalOrderNo: '', currency: 'USD', orderIds: ['o1', 'o2'], teamIds: ['t1'], batchIds: ['b1'], status: 'draft', placedAt: null, placedBy: null,
  sharedCosts: [{ type: 'shipping', amount: '10', note: '' }], chargedAmountBase: null,
  allocations: [{ orderId: 'o1', shareOfSharedCosts: '6', overridden: false }, { orderId: 'o2', shareOfSharedCosts: '4', overridden: false }],
  allocationOverrideReason: '', expectedDeliveryDate: null, paymentNote: '', createdBy: 'u1', createdAt: at, updatedAt: at, version: 4,
  orders: [detail(1, [1]), detail(2, [2])], hiddenOrderCount: 0, hiddenOrdersTotalBase: '0', ...over,
});

const ordering = batch({ status: 'ordering', assignments: { approvers: [], purchasers: ['u1'], receivers: [] } });
const routes = (v: VendorTransactionView, extra: Routes = {}): Routes => ({
  'GET /meta': { version: '1', commit: 'unknown', baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled: false, emailEnabled: false },
  'GET /me': me({ memberships: [{ teamId: 't1', slug: 'robotics', name: 'Robotics', role: 'member', ssoRole: '', manualRole: 'member', defaultSubgroupId: '' }] }),
  'GET /batches/b1': ordering,
  'GET /vendor-transactions/v1': v,
  ...extra,
});

function show(r: Routes) {
  return renderWithApi(
    <MemoryRouter initialEntries={['/vendor-transactions/v1']}>
      <RouterRoutes><Route path="/vendor-transactions/:id" element={<VendorTransactionPage />} /></RouterRoutes>
    </MemoryRouter>,
    r,
  );
}

describe('VendorTransactionPage', () => {
  it('shows the external order, its orders and the editable sections to a purchaser', async () => {
    show(routes(view()));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Place external order' })).toBeTruthy();
    expect(screen.getByText('Shared costs total: 10.00 USD')).toBeTruthy();
    expect(screen.getByText('Shares 10.00 of 10.00 USD')).toBeTruthy();
    expect(screen.getByLabelText('Actual unit price of Part 1')).toBeTruthy();
    // no vendor order number before the order is placed
    expect(screen.queryByLabelText('Vendor order number')).toBeNull();
  });

  it('shows vendor order number in the title and an editable field once placed', async () => {
    const { calls } = show(routes(view({ status: 'placed', externalOrderNo: 'PO-9' }), { 'PATCH /vendor-transactions/v1': (b: unknown) => ({ ...view({ status: 'placed' }), ...(b as object), version: 5 }) }));
    expect(await screen.findByRole('heading', { name: 'Acme · PO-9' })).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Vendor order number'), { target: { value: 'PO-10' } });
    const details = screen.getByRole('heading', { name: 'Details' }).closest('.chakra-card__root') as HTMLElement;
    await act(async () => { fireEvent.click(within(details).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ externalOrderNo: 'PO-10' }));
  });

  it('keeps the title to the vendor while a draft', async () => {
    show(routes(view({ externalOrderNo: 'STALE' })));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy();
  });

  it('saves shared costs and the charged amount as partial PATCHes with If-Match', async () => {
    const { calls } = show(routes(view(), { 'PATCH /vendor-transactions/v1': (b: unknown) => ({ ...view(), ...(b as object), version: 5 }) }));
    await screen.findByRole('button', { name: 'Place external order' });
    fireEvent.change(screen.getByLabelText(/^Amount charged/), { target: { value: '1234' } });
    const details = screen.getByRole('heading', { name: 'Details' }).closest('.chakra-card__root') as HTMLElement;
    await act(async () => { fireEvent.click(within(details).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ chargedAmountBase: '1234' }));
    expect(calls.find((c) => c.method === 'PATCH')?.headers['If-Match']).toBe('"4"');
  });

  it('blocks a manual split that does not add up and asks for a reason', async () => {
    show(routes(view()));
    await screen.findByRole('button', { name: 'Place external order' });
    fireEvent.change(screen.getByLabelText('Share of Batch #7, order #1'), { target: { value: '7' } });
    expect(screen.getByText('Shares 11.00 of 10.00 USD')).toBeTruthy();
    const card = screen.getByRole('heading', { name: 'Allocation of shared costs' }).closest('.chakra-card__root') as HTMLElement;
    expect((within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits several shares at once without reading the event inside a deferred state update', async () => {
    // The second change in one batch is queued, so its updater runs after React cleared currentTarget.
    show(routes(view()));
    await screen.findByRole('button', { name: 'Place external order' });
    const first = screen.getByLabelText('Share of Batch #7, order #1');
    const second = screen.getByLabelText('Share of Batch #7, order #2');
    act(() => {
      fireEvent.change(first, { target: { value: '7' } });
      fireEvent.change(second, { target: { value: '3' } });
    });
    expect((first as HTMLInputElement).value).toBe('7');
    expect((second as HTMLInputElement).value).toBe('3');
    expect(screen.getByText('Shares 10.00 of 10.00 USD')).toBeTruthy();
  });

  it('places the draft after confirmation', async () => {
    const { calls } = show(routes(view(), { 'POST /vendor-transactions/v1/place': { ...view(), status: 'placed', version: 5 } }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Place external order' })); });
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Place external order' })); });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/vendor-transactions/v1/place')).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/place'))?.headers['If-Match']).toBe('"4"');
  });

  it('is read-only for a non-purchaser and for hidden orders', async () => {
    show(routes(view(), { 'GET /batches/b1': batch({ status: 'ordering' }) }));
    expect(await screen.findByText(/only the purchasers of all its batches can edit/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Place external order' })).toBeNull();
    cleanup();
    show(routes(view({ hiddenOrderCount: 2, hiddenOrdersTotalBase: '500' })));
    expect(await screen.findByText(/2 more orders are hidden from you, totalling 500.00 TWD/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Place external order' })).toBeNull();
  });
});
