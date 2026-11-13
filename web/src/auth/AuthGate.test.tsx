import { MantineProvider } from '@mantine/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { AppAuthProvider } from './AuthGate';
import { createUserManager } from './oidc';
import { createSession } from './session';

const config = {
  apiBaseUrl: 'https://api.example.org',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub-web', scope: 'openid profile email' },
};

beforeAll(() => {
  // Mantine needs matchMedia, which jsdom lacks.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  void i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function mount(signinRedirect: () => Promise<void>) {
  const manager = createUserManager(config, window.location.origin, '/');
  const session = createSession(manager, { storage: null });
  const redirect = vi.spyOn(manager, 'signinRedirect').mockImplementation(signinRedirect);
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <AppAuthProvider manager={manager} session={session}>
          <p>secret app</p>
        </AppAuthProvider>
      </MantineProvider>
    </I18nextProvider>,
  );
  return { redirect };
}

describe('AppAuthProvider', () => {
  it('starts sign-in with the current route when there is no user (tokens are not persisted)', async () => {
    window.history.replaceState(null, '', '/batches/7?tab=review');
    const { redirect } = mount(async () => undefined);
    await act(async () => {});
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith({ state: { returnTo: '/batches/7?tab=review' } });
    expect(screen.getByText('Signing you in…')).toBeTruthy();
    expect(screen.queryByText('secret app')).toBeNull();
  });

  it('shows the sign-in error page when the identity provider is unreachable', async () => {
    mount(async () => {
      throw new Error('Failed to fetch discovery document');
    });
    await act(async () => {});
    expect(await screen.findByText('Sign-in failed')).toBeTruthy();
    expect(screen.getByText('Failed to fetch discovery document')).toBeTruthy();
  });
});
