import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { batch, renderWithApi } from '../../test/fakeApi';
import { MyTasksCard } from './MyTasksCard';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const empty = { proposalsToHandle: [], itemsToReview: [], returnedItems: [], batchesToOrder: [], itemsToReceive: [], openExceptions: [] };

describe('MyTasksCard', () => {
  it('lists batches to order with their count as a badge, linking to the batch', async () => {
    renderWithApi(<MemoryRouter><MyTasksCard /></MemoryRouter>, { 'GET /me/tasks': { ...empty, batchesToOrder: [{ batch: batch({ status: 'ordering' }), count: 3 }] } });
    const link = await screen.findByRole('link', { name: /Spring order/ });
    // The count is a badge beside the link, not text inside it.
    expect(link.textContent).toBe('#7 Spring order');
    expect(screen.getByText('3 to order')).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/batches/b1');
    expect(screen.getByText('Items to order')).toBeTruthy();
  });
  it('shows the empty state when nothing is waiting', async () => {
    renderWithApi(<MemoryRouter><MyTasksCard /></MemoryRouter>, { 'GET /me/tasks': empty });
    expect(await screen.findByText('Nothing needs your attention.')).toBeTruthy();
  });
});
