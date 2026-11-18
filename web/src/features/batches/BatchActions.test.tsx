import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, item, renderWithApi } from '../../test/fakeApi';
import { BatchActions } from './BatchActions';
import type { Caller } from './rules';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const admin: Caller = { userId: 'u1', isSystemAdmin: false, teamRole: 'admin', archived: false, isPurchaser: false, isReceiver: false };

describe('review confirmation', () => {
  it('summarises how many items were approved and rejected', async () => {
    const items = [item(1, { status: 'approved' }), item(2, { status: 'approved' }), item(3, { status: 'rejected' }), item(4, { status: 'withdrawn' })];
    renderWithApi(<BatchActions batch={batch({ status: 'reviewing' })} caller={admin} pendingItems={0} undecidedItems={0} items={items} />, { 'GET /reference-rates': { items: [] }, 'GET /meta': { baseCurrency: 'TWD', supportedCurrencies: ['TWD'] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm review' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Approved: 2, rejected: 1')).toBeTruthy();
  });
});
