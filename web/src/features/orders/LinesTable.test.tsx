import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { renderWithApi } from '../../test/fakeApi';
import type { VendorOrder, VendorOrderLine } from '../../api/types';
import { LinesTable } from './LinesTable';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const at = '2026-01-01T00:00:00Z';
const line = (n: number, over: Partial<VendorOrderLine>): VendorOrderLine => ({
  id: `l${n}`, vendorOrderId: 'vo1', lineNo: n, teamId: 't1', itemId: null, requester: null, batchId: null, name: `Part ${n}`, sku: '', productUrl: '', quantity: 1, unitPrice: null,
  returnedQuantity: 0, expectedQuantity: 1, receivedQuantity: 0, openProblemQuantity: 0, closure: null, status: 'draft', lineC: null, costProvisional: false, separateProvisional: false, costBase: null, sharedBase: null,
  separateBase: null, totalBase: null, createdAt: at, updatedAt: at, vendorOrderVersion: 1, vendorOrderNumber: 1, problems: [], ...over,
});

describe('LinesTable', () => {
  it('links the line name to its product page only when it has a safe URL', () => {
    const order = { id: 'vo1', status: 'draft', currency: 'USD', totals: { provisional: false, separateBase: null, netBase: null }, lines: [line(1, { productUrl: 'https://shop.example.org/a' }), line(2, {})] } as unknown as VendorOrder;
    renderWithApi(<MemoryRouter><LinesTable order={order} baseCurrency="USD" teamName={() => 'Team'} canWrite={false} onEdit={() => {}} onRemove={() => {}} onClose={() => {}} onReopen={() => {}} /></MemoryRouter>, {});
    expect(screen.getByRole('link', { name: 'Part 1' }).getAttribute('href')).toBe('https://shop.example.org/a');
    expect(screen.queryByRole('link', { name: 'Part 2' })).toBeNull();
  });

  it('shows the item estimate only as the hint while typing, and an empty price as not set, with the currency only when it differs', () => {
    const order = { id: 'vo1', status: 'draft', currency: 'USD', totals: { provisional: false, separateBase: null, netBase: null }, lines: [
      line(1, { estimatedUnitPrice: { amount: '12.5', currency: 'USD' } }), line(2, { estimatedUnitPrice: { amount: '1500', currency: 'JPY' } }), line(3, {}),
    ] } as unknown as VendorOrder;
    renderWithApi(<MemoryRouter><LinesTable order={order} baseCurrency="USD" teamName={() => 'Team'} canWrite onEdit={() => {}} onRemove={() => {}} onClose={() => {}} onReopen={() => {}} /></MemoryRouter>, {});
    const input = (e: Element) => e.getAttribute('placeholder');
    const hints = Array.from(document.querySelectorAll('[data-scope="editable"][data-part="input"]')).map(input);
    const previews = Array.from(document.querySelectorAll('[data-scope="editable"][data-part="preview"]')).map((e) => e.textContent);
    expect(hints).toEqual(['12.5', '1500 JPY', '']);
    // An empty price never shows the estimate as if it were filled in.
    expect(previews).toEqual(['Not set', 'Not set', 'Not set']);
  });
});
