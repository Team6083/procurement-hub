import { describe, expect, it } from 'vitest';
import { buildCsp, buildHeaders, httpsOrigin } from './csp.mjs';

const config = {
  apiBaseUrl: 'https://api.example.org/base',
  oidc: { authority: 'https://sso.example.org/realms/example', clientId: 'procurement-hub-web', scope: 'openid' },
};

describe('httpsOrigin', () => {
  it('drops the path and normalises the host', () => {
    expect(httpsOrigin('https://API.Example.org:8443/x/y', 'f')).toBe('https://api.example.org:8443');
  });
  it.each([
    ['http://api.example.org', /https/],
    ['not a url', /not a valid URL/],
    ['https://user:pw@api.example.org', /userinfo/],
    ['https://api.example.org/?a=1', /query/],
    ['https://api.example.org/#x', /fragment/],
    ["https://api.example.org';script-src", /plain hostname|not a valid URL/],
    ['https://*.example.org', /plain hostname|not a valid URL/],
  ])('rejects %s', (value, msg) => {
    expect(() => httpsOrigin(value, 'apiBaseUrl')).toThrow(msg);
  });
  it('names the field', () => {
    expect(() => httpsOrigin(undefined, 'oidc.authority')).toThrow(/^oidc\.authority/);
  });
});

describe('buildCsp', () => {
  it('starts from default-src none and opens only the listed sources', () => {
    expect(buildCsp(config)).toBe(
      [
        "default-src 'none'",
        "script-src 'self' https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' https://api.example.org https://sso.example.org https://cloudflareinsights.com",
        "img-src 'self' https:",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  });
  it('dedupes identical origins', () => {
    const csp = buildCsp({ ...config, oidc: { ...config.oidc, authority: 'https://api.example.org/auth' } });
    expect(csp).toContain("connect-src 'self' https://api.example.org https://cloudflareinsights.com;");
  });
  it('rejects non-https origins', () => {
    expect(() => buildCsp({ ...config, apiBaseUrl: 'http://localhost:8080' })).toThrow(/apiBaseUrl/);
  });
});

describe('buildHeaders', () => {
  const h = buildHeaders(config);
  it('sends the hardening headers on every path', () => {
    const all = h.slice(h.indexOf('/*\n'), h.indexOf('/assets/*'));
    expect(all).toContain('Content-Security-Policy: ');
    expect(all).toContain('X-Content-Type-Options: nosniff');
    expect(all).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(all).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(all).not.toContain('Cache-Control');
  });
  it('caches hashed assets immutably', () => {
    expect(h).toMatch(/\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n$/);
  });
});
