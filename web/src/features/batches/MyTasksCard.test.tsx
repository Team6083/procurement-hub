import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, renderWithApi } from '../../test/fakeApi';
import { MyTasksCard } from './MyTasksCard';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const empty = { proposalsToHandle: [], itemsToReview: [], returnedItems: [], reviewsToConfirm: [] };

describe('MyTasksCard', () => {
  it('lists reviews to confirm with their count as a badge, linking to the batch', async () => {
    renderWithApi(<MemoryRouter><MyTasksCard /></MemoryRouter>, { 'GET /me/tasks': { ...empty, reviewsToConfirm: [{ batch: batch({ status: 'reviewing' }), count: 3 }] } });
    const link = await screen.findByRole('link', { name: /Spring order/ });
    // The count is a badge beside the link, not text inside it.
    expect(link.textContent).toBe('#7 Spring order');
    expect(screen.getByText('3 decided')).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/batches/b1');
    expect(screen.getByText('Reviews to confirm')).toBeTruthy();
  });
  it('shows the empty state when nothing is waiting', async () => {
    renderWithApi(<MemoryRouter><MyTasksCard /></MemoryRouter>, { 'GET /me/tasks': empty });
    expect(await screen.findByText('Nothing needs your attention.')).toBeTruthy();
  });
  it('lists purchasing and receiving work instead of saying all caught up', async () => {
    renderWithApi(<MemoryRouter><MyTasksCard /></MemoryRouter>, {
      'GET /me/tasks': { ...empty, draftVendorOrders: { count: 2 }, openProblems: { count: 1 }, linesToClose: { count: 0 }, deliveriesToMatch: { count: 3 } },
    });
    const draft = await screen.findByRole('link', { name: 'Draft vendor orders' });
    expect(draft.getAttribute('href')).toBe('/vendor-orders?status=draft');
    expect(screen.getByRole('link', { name: 'Delivery problems to resolve' }).getAttribute('href')).toBe('/receiving');
    expect(screen.getByRole('link', { name: 'Delivery lines waiting for a match' }).getAttribute('href')).toBe('/receiving');
    // A zero count shows no group, and the empty state stays away.
    expect(screen.queryByText('Lines to close')).toBeNull();
    expect(screen.queryByText('Nothing needs your attention.')).toBeNull();
  });
});
