import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithApi } from '../../test/fakeApi';
import { CreateTeamModal } from './CreateTeamModal';

const tara = { id: 'u9', username: 'tara', email: 'tara@example.org', displayName: 'Tara' };

describe('CreateTeamModal', () => {
  // The user picker's listbox must not land outside the modal dialog: the dialog hides
  // everything outside itself from assistive technology (aria-hidden), options included.
  it('offers found users as accessible options inside the dialog', async () => {
    const { calls } = renderWithApi(
      <MemoryRouter>
        <CreateTeamModal open onClose={() => undefined} />
      </MemoryRouter>,
      { 'GET /users': { items: [tara], nextCursor: null } },
    );
    const input = await screen.findByRole('combobox', { name: 'First team admin' });
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: 'Ta' } });
    await waitFor(() => expect(calls.some((c) => c.path === '/users')).toBe(true));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', { name: 'Tara (tara@example.org)' });
    expect(screen.getByRole('dialog').contains(option)).toBe(true);
    expect(option.closest('[aria-hidden="true"]')).toBeNull();
  });
});
