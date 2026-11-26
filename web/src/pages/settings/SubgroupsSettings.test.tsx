import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Team } from '../../api/types';
import { TeamContext } from '../../features/teams/TeamContext';
import i18n from '../../i18n';
import { chooseMenuItem, openRowMenu, rowWith } from '../../test/dataTable';
import { apiError, me, renderWithApi, team, type Routes } from '../../test/fakeApi';
import { SubgroupsSettings } from './SubgroupsSettings';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

function setup(t: Team, routes: Routes = {}) {
  return renderWithApi(
    <TeamContext.Provider value={{ teamId: t.id, slug: t.slug, team: t, full: t, canAdmin: true, isMember: true }}>
      <SubgroupsSettings />
    </TeamContext.Provider>,
    {
      'GET /me': me(),
      'PATCH /teams/t1/subgroups/g2': (body: unknown) => ({ ...t, subgroups: t.subgroups.map((g) => (g.id === 'g2' ? { ...g, ...(body as object) } : g)), version: t.version + 1 }),
      ...routes,
    },
  );
}

/** Opens the edit dialog of "Electrical", sets its aliases and saves; returns the dialog. */
async function saveAliases(aliases: string) {
  await openRowMenu(rowWith('Electrical'));
  await chooseMenuItem('Edit');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Aliases' }), { target: { value: aliases } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  });
  return dialog;
}

describe('SubgroupsSettings aliases', () => {
  it('shows each alias as its own badge, even one with a comma', () => {
    setup(team({ subgroups: [{ id: 'g1', name: 'Mechanical', aliases: ['Mech', 'Arm, base'], active: true }] }));
    expect(screen.getByText('Mech')).toBeTruthy();
    expect(screen.getByText('Arm, base')).toBeTruthy();
    expect(screen.queryByText('Mech, Arm, base')).toBeNull();
  });

  it('splits the textarea on new lines and commas, trims, and drops empty and repeated aliases', async () => {
    const { calls } = setup(team());
    await saveAliases(' SW, Soft \n\n Code ,, \nSW\n  ');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Electrical', aliases: ['SW', 'Soft', 'Code'] });
  });

  it('refuses more than 50 aliases without sending', async () => {
    const { calls } = setup(team());
    const many = Array.from({ length: 51 }, (_, i) => `a${i}`).join('\n');
    const dialog = await saveAliases(many);
    expect(await within(dialog).findByText('At most 50 aliases.')).toBeTruthy();
    expect(within(dialog).getByText(/^One alias per line or separated by commas/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('accepts 50 aliases after dropping repeats', async () => {
    const { calls } = setup(team());
    const fifty = Array.from({ length: 50 }, (_, i) => `a${i}`);
    await saveAliases([...fifty, 'a0', 'a1'].join(','));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect((calls.find((c) => c.method === 'PATCH')!.body as { aliases: string[] }).aliases).toEqual(fifty);
  });

  it('refuses an alias over 200 characters without sending', async () => {
    const { calls } = setup(team());
    await saveAliases(`SW\n${'x'.repeat(201)}`);
    expect(await screen.findByText('Each alias can be at most 200 characters.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
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
});
