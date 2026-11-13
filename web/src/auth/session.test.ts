import type { User } from 'oidc-client-ts';
import { describe, expect, it, vi } from 'vitest';
import { createSession, REDIRECT_AT_KEY, REDIRECT_COOLDOWN_MS } from './session';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function setup(user: Partial<User> | null = { access_token: 'a1', refresh_token: 'r1' }) {
  const manager = {
    getUser: vi.fn(async () => user as User | null),
    signinSilent: vi.fn(async () => ({ access_token: 'a2' }) as User),
    signinRedirect: vi.fn(async () => undefined),
  };
  let clock = 1_000_000;
  const storage = memoryStorage();
  const session = createSession(manager, { now: () => clock, storage, location: () => '/batches/7?tab=review' });
  return { manager, session, storage, advance: (ms: number) => (clock += ms) };
}

describe('session', () => {
  it('hands out the current access token', async () => {
    expect(await setup().session.getToken()).toBe('a1');
    expect(await setup(null).session.getToken()).toBeUndefined();
  });

  it('renews once for concurrent callers', async () => {
    const { manager, session } = setup();
    const [a, b] = await Promise.all([session.renew(), session.renew()]);
    expect([a, b]).toEqual(['a2', 'a2']);
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('renews only with a refresh token (never an iframe)', async () => {
    const { manager, session } = setup({ access_token: 'a1' });
    expect(await session.renew()).toBeUndefined();
    expect(manager.signinSilent).not.toHaveBeenCalled();
  });

  it('reports a failed renew as undefined', async () => {
    const { manager, session } = setup();
    manager.signinSilent.mockRejectedValueOnce(new Error('invalid_grant'));
    expect(await session.renew()).toBeUndefined();
  });

  it('signs in again with the current route in state', async () => {
    const { manager, session } = setup();
    await session.onAuthFailure();
    expect(manager.signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/batches/7?tab=review' } });
    expect(session.isRejected()).toBe(false);
  });

  it('stops redirect loops: a second failure within the cooldown shows the rejected state', async () => {
    const { manager, session, storage, advance } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    await session.onAuthFailure();
    advance(1_000);
    await session.onAuthFailure();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
    expect(session.isRejected()).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(storage.getItem(REDIRECT_AT_KEY)).not.toBeNull();
  });

  it('redirects again once the cooldown has passed', async () => {
    const { manager, session, advance } = setup();
    await session.onAuthFailure();
    advance(REDIRECT_COOLDOWN_MS + 1);
    await session.onAuthFailure();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(2);
  });
});
