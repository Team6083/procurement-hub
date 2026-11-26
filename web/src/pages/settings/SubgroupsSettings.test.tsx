import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Team } from '../../api/types';
import { TeamContext } from '../../features/teams/TeamContext';
import i18n from '../../i18n';
import { routes } from '../../router';
import { chooseMenuItem, openRowMenu, rowWith } from '../../test/dataTable';
import { apiError, me, renderWithApi, team, type Routes } from '../../test/fakeApi';
import { SubgroupsSettings } from './SubgroupsSettings';

// The add button sits in the section header, so the add path renders the real layout (no identity provider in tests).
vi.mock('../../auth/AuthGate', () => ({
  useSession: () => ({ user: { profile: { name: 'Alice Example' } }, logout: vi.fn() }),
}));

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

function setup(t: Team, routes: Routes = {}) {
  return renderWithApi(
    <TeamContext.Provider value={{ teamId: t.id, slug: t.slug, team: t, full: t, canAdmin: true, isMember: true }}>
      <SubgroupsSettings />
    </TeamContext.Provider>,
    {
      'GET /me': me(),
      'PATCH /teams/t1/subgroups/g1': (body: unknown) => ({ ...t, subgroups: t.subgroups.map((g) => (g.id === 'g1' ? { ...g, ...(body as object) } : g)), version: t.version + 1 }),
      'PATCH /teams/t1/subgroups/g2': (body: unknown) => ({ ...t, subgroups: t.subgroups.map((g) => (g.id === 'g2' ? { ...g, ...(body as object) } : g)), version: t.version + 1 }),
      ...routes,
    },
  );
}

/** Opens a subgroup's edit dialog, changes the given fields and saves; returns the dialog. */
async function edit(row: string, change: { name?: string; aliases?: string }) {
  await openRowMenu(rowWith(row));
  await chooseMenuItem('Edit');
  const dialog = await screen.findByRole('dialog');
  if (change.name !== undefined) fireEvent.change(within(dialog).getByRole('textbox', { name: /Subgroup name/ }), { target: { value: change.name } });
  if (change.aliases !== undefined) fireEvent.change(within(dialog).getByRole('textbox', { name: 'Aliases' }), { target: { value: change.aliases } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  });
  return dialog;
}

/** Edits the aliases of "Electrical" (no aliases yet). */
const saveAliases = (aliases: string) => edit('Electrical', { aliases });
const patchBody = (calls: { method: string; body: unknown }[]) => calls.find((c) => c.method === 'PATCH')?.body;

describe('SubgroupsSettings aliases', () => {
  it('shows each alias as its own badge, even one with a comma', () => {
    setup(team({ subgroups: [{ id: 'g1', name: 'Mechanical', aliases: ['Mech', 'Arm, base'], active: true }] }));
    expect(screen.getByText('Mech')).toBeTruthy();
    expect(screen.getByText('Arm, base')).toBeTruthy();
    expect(screen.queryByText('Mech, Arm, base')).toBeNull();
  });

  it('splits the textarea on new lines only, trims, and drops empty and repeated aliases', async () => {
    const { calls } = setup(team());
    await saveAliases(' SW \n\n Arm, base \n\t\nSW\n  ');
    await waitFor(() => expect(patchBody(calls)).toEqual({ name: 'Electrical', aliases: ['SW', 'Arm, base'] }));
  });

  it('keeps a stored alias with a comma unchanged when only the name is edited', async () => {
    const { calls } = setup(team({ subgroups: [{ id: 'g1', name: 'Mechanical', aliases: ['Mech', 'Arm, base'], active: true }] }));
    await edit('Mechanical', { name: 'Mechanics' });
    await waitFor(() => expect(patchBody(calls)).toEqual({ name: 'Mechanics', aliases: ['Mech', 'Arm, base'] }));
  });

  it('refuses more than 50 aliases without sending', async () => {
    const { calls } = setup(team());
    const many = Array.from({ length: 51 }, (_, i) => `a${i}`).join('\n');
    const dialog = await saveAliases(many);
    expect(await within(dialog).findByText('At most 50 aliases.')).toBeTruthy();
    expect(within(dialog).getByText(/^One alias per line\. /)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('accepts 50 aliases after dropping repeats', async () => {
    const { calls } = setup(team());
    const fifty = Array.from({ length: 50 }, (_, i) => `a${i}`);
    await saveAliases([...fifty, 'a0', 'a1'].join('\n'));
    await waitFor(() => expect(patchBody(calls)).toEqual({ name: 'Electrical', aliases: fifty }));
  });

  it('refuses an alias over 200 characters without sending', async () => {
    const { calls } = setup(team());
    await saveAliases(`SW\n${'x'.repeat(201)}`);
    expect(await screen.findByText('Each alias can be at most 200 characters.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('counts the 200-character limit in code points, so emoji count once', async () => {
    const { calls } = setup(team());
    const dialog = await saveAliases('😀'.repeat(201));
    expect(await within(dialog).findByText('Each alias can be at most 200 characters.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Aliases' }), { target: { value: '😀'.repeat(200) } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(patchBody(calls)).toEqual({ name: 'Electrical', aliases: ['😀'.repeat(200)] }));
  });

  it('names the clashing value of a 409 subgroup_name_conflict', async () => {
    setup(team(), { 'PATCH /teams/t1/subgroups/g2': apiError(409, 'subgroup_name_conflict', { value: 'Mech' }) });
    const dialog = await saveAliases('Mech');
    expect(await within(dialog).findByText('“Mech” is already used as a name or alias by another subgroup of the team (inactive subgroups included).')).toBeTruthy();
  });

  it('falls back to the generic text when the 409 has no value', async () => {
    setup(team(), { 'PATCH /teams/t1/subgroups/g2': apiError(409, 'subgroup_name_conflict') });
    const dialog = await saveAliases('Mech');
    expect(await within(dialog).findByText('This name or alias is already used by another subgroup of the team (inactive subgroups included).')).toBeTruthy();
  });

  it('keeps the plain text of a code without a _value text, even when details.value is set', async () => {
    setup(team(), { 'PATCH /teams/t1/subgroups/g2': apiError(400, 'invalid_request', { value: 'Mech' }) });
    const dialog = await saveAliases('Mech');
    expect(await within(dialog).findByText('The request is invalid. Check the highlighted fields and try again.')).toBeTruthy();
  });

  it('adds a subgroup with its aliases', async () => {
    const t = team();
    const router = createMemoryRouter(routes, { initialEntries: ['/teams/robotics/settings/subgroups'] });
    const { calls } = renderWithApi(<RouterProvider router={router} />, {
      'GET /meta': { build: { version: null, commit: null, builtAt: null }, baseCurrency: 'TWD', supportedCurrencies: ['TWD'], lookupEnabled: false, emailEnabled: false },
      'GET /me': me({ isSystemAdmin: true }),
      'GET /teams': { items: [{ id: 't1', slug: 'robotics', name: 'Robotics', description: '', archived: false }], nextCursor: null },
      'GET /teams/t1': t,
      'POST /teams/t1/subgroups': (body: unknown) => ({ ...t, subgroups: [...t.subgroups, { id: 'g3', active: true, ...(body as object) }], version: t.version + 1 }),
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Add subgroup' }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Subgroup name/ }), { target: { value: ' Software ' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Aliases' }), { target: { value: 'SW\nCode, tools' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add subgroup' }));
    });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Software', aliases: ['SW', 'Code, tools'] }));
  });
});
