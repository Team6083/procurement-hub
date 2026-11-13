import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from './config';

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
});
