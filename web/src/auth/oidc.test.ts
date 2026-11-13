import { InMemoryWebStorage, OidcClient, User } from 'oidc-client-ts';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { createUserManager, currentRoute, isCallbackPath, returnToFromState, safeReturnTo } from './oidc';

const config: AppConfig = {
  apiBaseUrl: 'https://api.example.org',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub-web', scope: 'openid profile email' },
};

describe('createUserManager', () => {
  it('configures an in-memory, refresh-token-only code flow client', () => {
    const s = createUserManager(config, 'https://app.example.org', '/').settings;
    expect(s.client_id).toBe('procurement-hub-web');
    expect(s.response_type).toBe('code');
    expect(s.scope).toBe('openid profile email');
    expect(s.redirect_uri).toBe('https://app.example.org/auth/callback');
    expect(s.post_logout_redirect_uri).toBe('https://app.example.org/');
    expect(s.automaticSilentRenew).toBe(true);
    expect(s.disablePKCE).toBe(false);
    expect((s.userStore as unknown as { _store: unknown })._store).toBeInstanceOf(InMemoryWebStorage);
  });

  it('puts the callback and logout targets under the base path', () => {
    const s = createUserManager(config, 'https://app.example.org', '/sub/').settings;
    expect(s.redirect_uri).toBe('https://app.example.org/sub/auth/callback');
    expect(s.post_logout_redirect_uri).toBe('https://app.example.org/sub/');
  });

  it('builds a PKCE S256 authorization request carrying the return route in state', async () => {
    const { settings } = createUserManager(config, 'https://app.example.org', '/');
    const client = new OidcClient({
      ...settings,
      metadata: { issuer: config.oidc.authority, authorization_endpoint: 'https://sso.example.org/auth' },
    });
    const req = await client.createSigninRequest({ state: { returnTo: '/batches?x=1' } });
    const url = new URL(req.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(req.state.data).toEqual({ returnTo: '/batches?x=1' });
  });
});

describe('silent renew', () => {
  it('refuses the iframe fallback when there is no refresh token', async () => {
    const manager = createUserManager(config, 'https://app.example.org', '/');
    await manager.storeUser(new User({ access_token: 'a', token_type: 'Bearer', profile: { sub: 's', iss: 'i', aud: 'c', exp: 0, iat: 0 } }));
    await expect(manager.signinSilent()).rejects.toThrow(/refresh token/);
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('return route', () => {
  it('captures path, query and hash', () => {
    expect(currentRoute({ pathname: '/batches/1', search: '?tab=items', hash: '#x' })).toBe('/batches/1?tab=items#x');
  });
  it.each([
    ['/batches/1?tab=items', '/', '/batches/1?tab=items'],
    ['//evil.example.org', '/', '/'],
    ['https://evil.example.org/', '/', '/'],
    ['/\\evil.example.org', '/', '/'],
    ['/auth/callback?code=1', '/', '/'],
    [42, '/', '/'],
    ['/sub/teams/a', '/sub/', '/sub/teams/a'],
    ['/sub', '/sub/', '/sub'],
    ['/other', '/sub/', '/sub/'],
    ['/sub/auth/callback', '/sub/', '/sub/'],
  ])('safeReturnTo(%j) with base %s -> %s', (value, base, want) => {
    expect(safeReturnTo(value, base)).toBe(want);
  });
  it('reads returnTo from the OIDC state', () => {
    expect(returnToFromState({ returnTo: '/reports' }, '/')).toBe('/reports');
    expect(returnToFromState(undefined, '/')).toBe('/');
  });
  it('recognises the callback path', () => {
    expect(isCallbackPath('/auth/callback', '/')).toBe(true);
    expect(isCallbackPath('/sub/auth/callback', '/sub/')).toBe(true);
    expect(isCallbackPath('/auth/callback', '/sub/')).toBe(false);
  });
});
