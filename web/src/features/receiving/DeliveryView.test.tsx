import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { Candidate, Delivery, DeliveryLine } from '../../api/types';
import { me, renderWithApi } from '../../test/fakeApi';
import { DeliveryView } from './DeliveryView';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const line = (over: Partial<DeliveryLine> = {}): DeliveryLine => ({
  id: 'dl1', deliveryId: 'd1', lineNo: 1, name: 'Motor', sku: 'M-1', goodQuantity: 3, problemQuantity: 1, problemType: 'damaged', problemNote: '',
  noMatch: null, matchState: 'unmatched', deliveryNumber: 4, deliveryVersion: 5, receivedAt: '2026-01-01', source: 'WCP', matches: [],
  matchedGoodQuantity: 0, matchedProblemQuantity: 0, ...over,
});
const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', number: 4, receivedAt: '2026-01-01', source: 'WCP', note: '', voided: null, createdBy: 'u1', createdAt: at, updatedAt: at, version: 5, lines: [line()], ...over,
});
const candidate: Candidate = {
  vendorOrderLineId: 'vol1', vendorOrderId: 'vo1', vendorOrderNumber: 12, vendorName: 'WCP', placedAt: at, lineNo: 1, name: 'Motor', sku: 'M-1',
  quantity: 3, receivedQuantity: 0, capacity: 3, matchedBy: 'sku', score: 1, suggestedGoodQuantity: 3, suggestedProblemQuantity: 0,
};

function show() {
  const router = createMemoryRouter([{ path: '/deliveries/:id', element: <DeliveryView id="d1" /> }], { initialEntries: ['/deliveries/d1'] });
  const matched = delivery({
    version: 6,
    lines: [line({ matchState: 'partial', matchedGoodQuantity: 3, matches: [{ id: 'm1', vendorOrderLineId: 'vol1', vendorOrderId: 'vo1', vendorOrderNumber: 12, lineNo: 1, lineName: 'Motor', goodQuantity: 3, problemQuantity: 0, problemId: null }] })],
  });
  return renderWithApi(<RouterProvider router={router} />, {
    'GET /me': me({ isReceiver: true }),
    'GET /deliveries/d1': delivery(),
    'GET /delivery-lines/dl1/suggestions': { items: [candidate] },
    'PUT /delivery-lines/dl1/matches': matched,
  });
}

describe('DeliveryView match flow', () => {
  it('opens on the suggested split, warns about over-delivery and saves clamped matches with the delivery version', async () => {
    const { calls } = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Match' }));
    const dialog = await screen.findByRole('dialog');
    const good = await within(dialog).findByLabelText('Good units for VO-12 line #1');
    const problem = within(dialog).getByLabelText('Problem units for VO-12 line #1');
    expect((good as HTMLInputElement).value).toBe('3');
    expect((problem as HTMLInputElement).value).toBe('0');

    // The damaged unit does not fit: a hint, not an error, and the shortcut to mark the rest.
    fireEvent.change(problem, { target: { value: '1' } });
    expect(within(dialog).getByText('This line lacks only 3; the extra 1 will stay pending.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Save and mark the rest as not needed' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save matches' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/delivery-lines/dl1/matches');
    expect(put.body).toEqual({ matches: [{ vendorOrderLineId: 'vol1', goodQuantity: 3, problemQuantity: 0 }] });
    expect(put.headers['If-Match']).toBe('"5"');

    expect(await screen.findByRole('link', { name: 'VO-12 #1 Motor' })).toBeTruthy();
    expect(screen.getByText(/1 still pending/)).toBeTruthy();
  });
});
