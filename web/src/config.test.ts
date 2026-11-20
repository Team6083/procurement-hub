import { ConfigError } from '@team6083/ui';
import { describe, expect, it } from 'vitest';
import { parseConfig, withBase } from './config';

const valid = {
  apiBaseUrl: 'https://api.example.org',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub' },
};

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
