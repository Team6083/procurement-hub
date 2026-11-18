import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { apiError, batch, renderWithApi, team } from '../../test/fakeApi';
import { ItemFormModal } from './ItemFormModal';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const meta = (lookupEnabled: boolean) => ({ version: '1', commit: 'unknown', baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled, emailEnabled: false });
const found = { name: 'Wheel 5in', vendorId: null, vendorName: 'Acme Store', sku: 'W-5', unitPrice: { amount: '12.5', currency: 'USD' }, url: 'https://acme.example/w5', inStock: true };

function show(routes: Record<string, unknown>) {
  return renderWithApi(<ItemFormModal open onClose={() => undefined} batch={batch()} team={team()} defaultSubgroupId="g1" />, { 'GET /vendors': { items: [] }, ...routes });
}
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;

describe('ItemFormModal product lookup', () => {
  it('fills only empty fields, asks before overwriting, and sends autoFilledFields on create', async () => {
    const { calls } = show({ 'GET /meta': meta(true), 'GET /lookup': found, 'POST /batches/b1/items': {} });
    await screen.findByRole('button', { name: 'Look up' });
    fireEvent.change(field('Name'), { target: { value: 'My wheel' } });
    fireEvent.change(field('Product URL'), { target: { value: 'https://acme.example/w5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(field('SKU').value).toBe('W-5'));
    expect(field('Unit price').value).toBe('12.5');
    expect(field('Vendor name').value).toBe('Acme Store');
    expect(field('Name').value).toBe('My wheel');
    expect(screen.getByText(/different values.*Name/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(field('Name').value).toBe('Wheel 5in');
    expect(calls.find((c) => c.path === '/lookup')).toBeTruthy();
    // Editing a field ends its auto-filled mark.
    fireEvent.change(field('SKU'), { target: { value: 'W-6' } });
    fireEvent.change(field('Purpose'), { target: { value: 'Robot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.method === 'POST')?.body as { autoFilledFields: string[] };
    expect(body.autoFilledFields.sort()).toEqual(['estimatedUnitPrice', 'name', 'vendorId']);
  });

  it('shows a non-blocking message when the lookup fails', async () => {
    show({ 'GET /meta': meta(true), 'GET /lookup': apiError(404, 'lookup_not_found') });
    await screen.findByRole('button', { name: 'Look up' });
    fireEvent.change(field('Product URL'), { target: { value: 'https://acme.example/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/No product was found/)).toBeTruthy();
    expect(field('Name').disabled).toBe(false);
  });

  it('hides the lookup when it is disabled', async () => {
    show({ 'GET /meta': meta(false) });
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole('button', { name: 'Look up' })).toBeNull();
  });
});
