import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { useMe } from '../api/me';
import { apiError, renderWithApi } from '../test/fakeApi';
import { renderUI } from '../test/render';
import { AccessGate } from './AccessGate';
import { createAccessStore } from './access';

afterEach(cleanup);

describe('AccessGate (spec section 7.1)', () => {
  it('shows the app until access is denied, then only the no-access page', async () => {
    await i18n.changeLanguage('en');
    const store = createAccessStore();
    const signOut = vi.fn();
    renderUI(
      <AccessGate store={store} onSignOut={signOut}>
        <nav>app chrome</nav>
      </AccessGate>,
    );
    expect(screen.getByText('app chrome')).toBeTruthy();
    act(() => store.deny());
    expect(screen.queryByText('app chrome')).toBeNull();
    expect(screen.getByRole('heading', { name: "You don't have access to this service" })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('is translated', async () => {
    await i18n.changeLanguage('zh-TW');
    const store = createAccessStore();
    store.deny();
    renderUI(<AccessGate store={store} onSignOut={() => undefined}>x</AccessGate>);
    expect(screen.getByRole('heading', { name: '你沒有這個服務的存取權' })).toBeTruthy();
    expect(screen.getByText('請聯絡 admin。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
    await i18n.changeLanguage('en');
  });

  it('denies access when GET /me answers 403 missing_role', async () => {
    await i18n.changeLanguage('en');
    const store = createAccessStore();
    function Home() {
      const { me } = useMe();
      return <p>home {me?.username}</p>;
    }
    renderWithApi(
      <AccessGate store={store} onSignOut={() => undefined}>
        <Home />
      </AccessGate>,
      { 'GET /me': apiError(403, 'missing_role') },
      { onMissingRole: store.deny },
    );
    expect(await screen.findByRole('heading', { name: "You don't have access to this service" })).toBeTruthy();
    expect(screen.queryByText(/home/)).toBeNull();
  });
});
