import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { routes } from '../router';
import { batch, item, me, member, renderWithApi, team, type Routes } from '../test/fakeApi';
import { filterSelect } from '../test/dataTable';
import { shortDate } from '../features/dates';

// Logged-in pages with the real layout and a fake API (no identity provider in tests).
vi.mock('../auth/AuthGate', () => ({
  useSession: () => ({ user: { profile: { name: 'Alice Example' } }, logout: vi.fn() }),
}));

const tz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Taipei';
  void i18n.changeLanguage('en');
});
afterAll(() => {
  process.env.TZ = tz;
});
afterEach(cleanup);

const base: Routes = {
  'GET /meta': { build: { version: null, commit: null, builtAt: null }, baseCurrency: 'TWD', supportedCurrencies: ['TWD', 'USD'], lookupEnabled: false, emailEnabled: false },
  'GET /me': me(),
  'GET /teams': { items: [{ id: 't1', slug: 'robotics', name: 'Robotics', description: 'Robot team', archived: false }], nextCursor: null },
  'GET /teams/t1': team(),
  'GET /teams/t1/members': { items: [member('u1', 'Alice'), member('u2', 'Bob')], nextCursor: null },
  'GET /me/tasks': { proposalsToHandle: [], itemsToReview: [{ batch: batch(), count: 2 }], returnedItems: [], reviewsToConfirm: [] },
  'GET /batches': { items: [batch()], nextCursor: null },
  'GET /batches/b1': batch(),
  'GET /batches/b1/items': {
    items: [item(1, { name: 'Servo', productUrl: 'https://shop.example.org/servo' }), item(2, { name: 'Wheel', requesterId: 'u2', priority: 5 })],
    nextCursor: null,
  },
  'GET /audit': { items: [], nextCursor: null },
};

function open(path: string, extra: Routes = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return { router, ...renderWithApi(<RouterProvider router={router} />, { ...base, ...extra }) };
}

describe('logged-in pages render with Chakra and API data', () => {
  it('home: my tasks and teams', async () => {
    open('/');
    expect(await screen.findByRole('link', { name: '#7 Spring order' })).toBeTruthy();
    expect(screen.getByText('2 pending')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Robotics' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByLabelText('Open menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alice Example' })).toBeTruthy();
  });

  it('batches list with filters', async () => {
    open('/batches');
    expect(await screen.findByRole('link', { name: 'Spring order' })).toBeTruthy();
    expect(await filterSelect('Team')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
  });

  it('batch: header, items, review and edit dialog with local deadline', async () => {
    open('/batches/b1');
    expect(await screen.findByRole('heading', { name: '#7 Spring order' })).toBeTruthy();
    expect(screen.getByText('Parts for the arm')).toBeTruthy();
    // 2026-03-01T16:30Z in UTC+8
    expect(screen.getByText(shortDate('2026-03-01T16:30:00Z'))).toBeTruthy();
    expect(shortDate('2026-03-01T16:30:00Z', { now: new Date('2026-06-01T00:00:00Z') })).toBe('3/2 00:30');
    const servo = await screen.findByRole('link', { name: 'Servo' });
    expect(servo.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);

    expect(screen.queryByRole('tab', { name: 'Review' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Purchasing' })).toBeTruthy();
    // An approver's items open on the pending filter, shown as one set filter.
    expect(screen.getByRole('button', { name: /^Filter\s*1$/ })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Edit batch' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Deadline') as HTMLInputElement).value).toBe('2026-03-02T00:30');
    expect(within(dialog).getAllByRole('checkbox', { name: 'Alice' })[0]).toHaveProperty('checked', true);
  });

  it('batch: changing the deadline sends UTC', async () => {
    const { calls } = open('/batches/b1', { 'PATCH /batches/b1': (body: unknown) => ({ ...batch(), ...(body as object), version: 3 }) });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Deadline'), { target: { value: '2026-03-10T09:00' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ deadline: '2026-03-10T01:00:00.000Z' }));
  });

  it('team members tab and settings shell', async () => {
    open('/teams/robotics/members');
    expect(await screen.findByRole('heading', { name: 'Robotics' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('img', { name: /^Bob/ })).toBeTruthy();
    cleanup();
    open('/teams/robotics/settings/subgroups');
    expect(await screen.findByRole('heading', { name: 'Robotics' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Subgroups' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText('Mechanical').length).toBeGreaterThan(0);
    expect(screen.getByText('Mech')).toBeTruthy();
  });
});
