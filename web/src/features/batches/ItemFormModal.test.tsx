import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { apiError, batch, item, renderWithApi, team } from '../../test/fakeApi';
import { ItemFormModal } from './ItemFormModal';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const meta = (lookupEnabled: boolean) => ({ build: { version: null, commit: null, builtAt: null }, baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled, emailEnabled: false });
const found = { name: 'Wheel 5in', vendorId: null, vendorName: 'Acme Store', sku: 'W-5', unitPrice: { amount: '12.5', currency: 'USD' }, url: 'https://acme.example/w5', inStock: true };

function show(routes: Record<string, unknown>) {
  return renderWithApi(<ItemFormModal open onClose={() => undefined} batch={batch()} team={team()} defaultSubgroupId="g1" />, { 'GET /vendors': { items: [] }, ...routes });
}
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;

const query = () => screen.getByPlaceholderText(/SKU/) as HTMLInputElement;
const lookUp = (q: string) => {
  fireEvent.change(query(), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
};

describe('ItemFormModal product lookup', () => {
  it('starts collapsed with only the query and the non-product fields', async () => {
    show({ 'GET /meta': meta(true) });
    await screen.findByRole('button', { name: 'Fill in manually' });
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(screen.queryByLabelText(/^SKU/)).toBeNull();
    expect(screen.queryByLabelText(/^Unit price/)).toBeNull();
    expect(screen.queryByText('Vendor')).toBeNull();
    expect(field('Quantity')).toBeTruthy();
    expect(field('Purpose')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fill in manually' }));
    expect(field('Name')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/SKU/)).toBeNull();
  });

  it('expands and fills on success, asks before overwriting, and sends autoFilledFields on create', async () => {
    const { calls } = show({ 'GET /meta': meta(true), 'GET /lookup': found, 'POST /batches/b1/items': {} });
    await screen.findByRole('button', { name: 'Look up' });
    lookUp('https://acme.example/w5');
    await waitFor(() => expect(field('SKU').value).toBe('W-5'));
    expect(field('Unit price').value).toBe('12.5');
    expect(field('Vendor name').value).toBe('Acme Store');
    expect(field('Product URL').value).toBe('https://acme.example/w5');
    // Name, vendor, SKU and price each show the mark (the URL was seeded from the query).
    expect(screen.getAllByText('Auto-filled by lookup')).toHaveLength(4);
    fireEvent.change(field('Name'), { target: { value: 'My wheel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText(/different values.*Name/);
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

  it('expands with a non-blocking message when the lookup fails', async () => {
    show({ 'GET /meta': meta(true), 'GET /lookup': apiError(404, 'lookup_not_found') });
    await screen.findByRole('button', { name: 'Look up' });
    lookUp('nope-123');
    expect(await screen.findByText(/No product was found/)).toBeTruthy();
    expect(field('Name').disabled).toBe(false);
    expect(field('SKU').value).toBe('nope-123');
  });

  it('shows every field and no query box when the lookup is disabled', async () => {
    show({ 'GET /meta': meta(false) });
    await screen.findByLabelText(/^Name/);
    expect(field('Quantity')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill in manually' })).toBeNull();
  });
});

describe('ItemFormModal save and resubmit', () => {
  it('is disabled with a hint until a returned item is edited', async () => {
    const returned = item(1, { status: 'returned', version: 3, review: { decision: 'returned', by: 'a', at: '2026-01-02T00:00:00Z', comment: 'fix', forced: false, atVersion: 3 } });
    renderWithApi(<ItemFormModal open onClose={() => undefined} batch={batch()} team={team()} defaultSubgroupId="g1" item={returned} resubmittable />, { 'GET /vendors': { items: [] }, 'GET /meta': meta(false) });
    const main = await screen.findByRole('button', { name: 'Save and resubmit' });
    expect((main as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save options' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Edit the item before resubmitting it.')).toBeTruthy();
    fireEvent.change(field('Purpose'), { target: { value: 'changed' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save and resubmit' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
