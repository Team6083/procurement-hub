import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConfig, buildCsp, buildHeaders, generate, resolveCommit } from '../scripts/gen-runtime-files.mjs';

const full = {
  APP_API_URL: 'https://api.example.org/base',
  APP_OIDC_AUTHORITY: 'https://sso.example.org/realms/example',
  APP_OIDC_CLIENT_ID: 'procurement-hub',
};

describe('buildCsp', () => {
  it('uses only self when variables are absent', () => {
    expect(buildCsp({})).toContain("connect-src 'self';");
  });
  it('adds API and OIDC origins (not paths)', () => {
    const csp = buildCsp(full);
    expect(csp).toContain("connect-src 'self' https://api.example.org https://sso.example.org;");
    expect(csp).toContain("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
    expect(csp).toContain("frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  });
  it('dedupes identical origins', () => {
    const csp = buildCsp({ ...full, APP_OIDC_AUTHORITY: 'https://api.example.org/auth' });
    expect(csp).toContain("connect-src 'self' https://api.example.org;");
  });
  it('rejects invalid URLs', () => {
    expect(() => buildCsp({ ...full, APP_API_URL: 'not a url' })).toThrow(/APP_API_URL/);
  });
});

describe('buildHeaders', () => {
  it('includes nosniff and referrer policy', () => {
    const h = buildHeaders({});
    expect(h).toContain('X-Content-Type-Options: nosniff');
    expect(h).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(h.startsWith('/*\n')).toBe(true);
  });
});

describe('buildConfig', () => {
  it('returns null unless all required variables are set', () => {
    expect(buildConfig({})).toBeNull();
    expect(buildConfig({ ...full, APP_OIDC_CLIENT_ID: '  ' })).toBeNull();
  });
  it('builds config with optional scope', () => {
    expect(buildConfig(full)).toEqual({
      apiBaseUrl: full.APP_API_URL,
      oidc: { authority: full.APP_OIDC_AUTHORITY, clientId: 'procurement-hub' },
    });
    expect(buildConfig({ ...full, APP_OIDC_SCOPE: 'openid' })?.oidc).toMatchObject({ scope: 'openid' });
  });
});

describe('resolveCommit', () => {
  const git = () => 'gitsha\n';
  it('prefers APP_COMMIT, then CF, then Workers, then git', () => {
    expect(resolveCommit({ APP_COMMIT: 'a', CF_PAGES_COMMIT_SHA: 'b', WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('a');
    expect(resolveCommit({ APP_COMMIT: '', CF_PAGES_COMMIT_SHA: 'b', WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('b');
    expect(resolveCommit({ WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('c');
    expect(resolveCommit({}, git)).toBe('gitsha');
  });
  it('falls back to unknown', () => {
    expect(resolveCommit({}, () => '')).toBe('unknown');
  });
});

describe('generate', () => {
  it('writes config.json only when configured, always _headers', () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'gen-')), 'dist');
    try {
      expect(generate({}, dir).configWritten).toBe(false);
      expect(existsSync(path.join(dir, 'config.json'))).toBe(false);
      expect(existsSync(path.join(dir, '_headers'))).toBe(true);
      expect(generate(full, dir).configWritten).toBe(true);
      expect(JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')).apiBaseUrl).toBe(full.APP_API_URL);
    } finally {
      rmSync(path.dirname(dir), { recursive: true, force: true });
    }
  });
});
