import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Team } from '../../api/types';
import { TeamContext } from '../../features/teams/TeamContext';
import i18n from '../../i18n';
import { me, renderWithApi, team } from '../../test/fakeApi';
import { GeneralSettings } from './GeneralSettings';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

function setup(t: Team) {
  return renderWithApi(
    <TeamContext.Provider value={{ teamId: t.id, slug: t.slug, team: t, full: t, canAdmin: true, isMember: true }}>
      <GeneralSettings />
    </TeamContext.Provider>,
    {
      'GET /me': me(),
      'PATCH /teams/t1': (body: unknown) => ({ ...t, ...(body as object), version: t.version + 1 }),
    },
  );
}

const field = (n: number) => screen.getByRole('textbox', { name: `Priority ${n}` }) as HTMLInputElement;

// The labels live at form paths priority.1 … priority.5; numeric segments must stay object keys.
describe('GeneralSettings priority labels', () => {
  it('shows saved labels per level and sends only non-blank labels keyed by level', async () => {
    const { calls } = setup(team({ priorityLabels: { '5': 'Critical', '1': 'Nice' } }));
    expect(field(5).value).toBe('Critical');
    expect(field(1).value).toBe('Nice');
    expect(field(3).value).toBe('');
    expect(field(3).placeholder).toBe('Better to buy, as a spare');

    fireEvent.change(field(1), { target: { value: '' } });
    fireEvent.change(field(4), { target: { value: 'Likely used' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ priorityLabels: { '5': 'Critical', '4': 'Likely used' } });
    expect(Array.isArray((patch.body as { priorityLabels: unknown }).priorityLabels)).toBe(false);
  });

  it('shows a validation error on the right level', async () => {
    const { calls } = setup(team());
    fireEvent.change(field(2), { target: { value: 'x'.repeat(201) } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(await screen.findByText('This value is too long.')).toBeTruthy();
    expect(field(2).getAttribute('aria-invalid')).toBe('true');
    expect(field(3).getAttribute('aria-invalid')).toBeNull();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
