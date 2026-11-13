import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, parseConfig, withBase } from './config';

const valid = {
  apiBaseUrl: 'https://api.example.org',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub' },
};

const respond = (status: number, body: string) => (async () => new Response(body, { status })) as typeof fetch;

describe('parseConfig', () => {
  it('accepts valid config and defaults scope', () => {
    expect(parseConfig(valid).oidc.scope).toBe('openid profile email');
  });
  it('rejects bad shapes', () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, apiBaseUrl: 'nope' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, oidc: { authority: valid.oidc.authority, clientId: '' } })).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('loads valid config', async () => {
    expect((await loadConfig(respond(200, JSON.stringify(valid)))).apiBaseUrl).toBe(valid.apiBaseUrl);
  });
  it('reports missing on 404 and network failure', async () => {
    await expect(loadConfig(respond(404, ''))).rejects.toMatchObject({ kind: 'missing' });
    await expect(loadConfig((async () => { throw new TypeError('x'); }) as typeof fetch)).rejects.toMatchObject({ kind: 'missing' });
  });
  it('reports invalid on bad JSON or schema', async () => {
    await expect(loadConfig(respond(200, '<html>'))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(loadConfig(respond(200, '{}'))).rejects.toMatchObject({ kind: 'invalid' });
  });
  it('fetches config.json relative to the base path, revalidating the cache', async () => {
    const f = vi.fn(respond(200, JSON.stringify(valid)));
    await loadConfig(f as typeof fetch, '/procurement/');
    expect(f).toHaveBeenCalledWith('/procurement/config.json', { cache: 'no-cache' });
    await loadConfig(f as typeof fetch, '/');
    expect(f).toHaveBeenLastCalledWith('/config.json', { cache: 'no-cache' });
  });
  it('treats an SPA fallback (HTML) as missing', async () => {
    const html = (async () =>
      new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })) as typeof fetch;
    await expect(loadConfig(html)).rejects.toMatchObject({ kind: 'missing' });
  });
});

describe('withBase', () => {
  it('joins paths onto the base path', () => {
    expect(withBase('/auth/callback', '/')).toBe('/auth/callback');
    expect(withBase('/auth/callback', '/sub/')).toBe('/sub/auth/callback');
    expect(withBase('x', '/sub')).toBe('/sub/x');
  });
});

describe('parseConfig scope rules', () => {
  it('rejects offline_access and unknown keys', () => {
    expect(() => parseConfig({ ...valid, oidc: { ...valid.oidc, scope: 'openid offline_access' } })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, typo: true })).toThrow(ConfigError);
  });
});
