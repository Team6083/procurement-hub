import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWrangler, prepare, writeConfig } from './write-config.mjs';

const valid = {
  apiBaseUrl: 'https://api.example.org',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub-web' },
};

describe('prepare', () => {
  it('fills in the default scope', () => {
    expect(prepare(JSON.stringify(valid)).config.oidc.scope).toBe('openid profile email');
  });
  it.each([
    [undefined, /not set/],
    ['  ', /not set/],
    ['{bad', /not valid JSON/],
    ['{}', /invalid/],
    [JSON.stringify({ ...valid, extra: 1 }), /extra/],
    [JSON.stringify({ ...valid, oidc: { ...valid.oidc, scope: 'openid offline_access' } }), /offline_access/],
    [JSON.stringify({ ...valid, oidc: { ...valid.oidc, clientId: '' } }), /clientId/],
    // Valid for the app (local dev), but the CSP only accepts https origins.
    [JSON.stringify({ ...valid, apiBaseUrl: 'http://localhost:8080' }), /apiBaseUrl must be an https/],
    [JSON.stringify({ ...valid, oidc: { ...valid.oidc, authority: 'https://sso.example.org/?x=1' } }), /oidc\.authority/],
  ])('rejects %s', (raw, msg) => {
    expect(() => prepare(raw)).toThrow(msg);
  });
});

describe('buildWrangler', () => {
  it('serves dist as a single-page application with a fixed compatibility date', () => {
    const w = buildWrangler({});
    expect(w).toMatchObject({
      name: 'procurement-hub',
      workers_dev: true,
      assets: { directory: './dist', not_found_handling: 'single-page-application' },
    });
    expect(w.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(buildWrangler({ WORKERS_DEV: 'false' }).workers_dev).toBe(false);
  });
});

describe('writeConfig', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('requires a build first', () => {
    root = mkdtempSync(path.join(tmpdir(), 'write-config-'));
    expect(() => writeConfig({ APP_CONFIG: JSON.stringify(valid) }, root)).toThrow(/npm run build/);
  });

  it('writes config.json, _headers and the wrangler config', () => {
    root = mkdtempSync(path.join(tmpdir(), 'write-config-'));
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'index.html'), '');
    writeConfig({ APP_CONFIG: JSON.stringify(valid) }, root);
    expect(JSON.parse(readFileSync(path.join(root, 'dist', 'config.json'), 'utf8'))).toEqual({
      ...valid,
      oidc: { ...valid.oidc, scope: 'openid profile email' },
    });
    expect(readFileSync(path.join(root, 'dist', '_headers'), 'utf8')).toContain('https://sso.example.org');
    expect(existsSync(path.join(root, 'wrangler.generated.jsonc'))).toBe(true);
  });

  it('writes nothing for an invalid APP_CONFIG', () => {
    root = mkdtempSync(path.join(tmpdir(), 'write-config-'));
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'index.html'), '');
    expect(() => writeConfig({ APP_CONFIG: '{bad' }, root)).toThrow();
    expect(existsSync(path.join(root, 'dist', 'config.json'))).toBe(false);
    expect(existsSync(path.join(root, 'dist', '_headers'))).toBe(false);
  });
});
