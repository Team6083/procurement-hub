// Generates deployment files into dist/ (spec section 6.2):
//   - config.json  only if APP_API_URL, APP_OIDC_AUTHORITY and APP_OIDC_CLIENT_ID are set
//   - _headers     always (CSP, nosniff, Referrer-Policy)
// Also exports resolveCommit(), used by vite.config.ts for __APP_COMMIT__.
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nonEmpty = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/** First non-empty of APP_COMMIT, CF_PAGES_COMMIT_SHA, WORKERS_CI_COMMIT_SHA, git HEAD; else "unknown". */
export function resolveCommit(env, gitRevParse = gitHead) {
  return (
    nonEmpty(env.APP_COMMIT) ??
    nonEmpty(env.CF_PAGES_COMMIT_SHA) ??
    nonEmpty(env.WORKERS_CI_COMMIT_SHA) ??
    nonEmpty(gitRevParse()) ??
    'unknown'
  );
}

function originOf(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid absolute URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL: ${value}`);
  }
  return url.origin;
}

/** Returns the config.json object, or null when the required variables are not all set. */
export function buildConfig(env) {
  const apiBaseUrl = nonEmpty(env.APP_API_URL);
  const authority = nonEmpty(env.APP_OIDC_AUTHORITY);
  const clientId = nonEmpty(env.APP_OIDC_CLIENT_ID);
  if (!apiBaseUrl || !authority || !clientId) return null;
  originOf('APP_API_URL', apiBaseUrl);
  originOf('APP_OIDC_AUTHORITY', authority);
  const oidc = { authority, clientId };
  const scope = nonEmpty(env.APP_OIDC_SCOPE);
  if (scope) oidc.scope = scope;
  return { apiBaseUrl, oidc };
}

export function buildCsp(env) {
  const connect = ["'self'"];
  const cfg = buildConfig(env);
  if (cfg) {
    for (const o of [originOf('APP_API_URL', cfg.apiBaseUrl), originOf('APP_OIDC_AUTHORITY', cfg.oidc.authority)]) {
      if (!connect.includes(o)) connect.push(o);
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function buildHeaders(env) {
  return [
    '/*',
    `  Content-Security-Policy: ${buildCsp(env)}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '',
  ].join('\n');
}

/** Prepares distDir (cleaned) and writes the runtime files. */
export function generate(env, distDir) {
  const cfg = buildConfig(env);
  const headers = buildHeaders(env);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  if (cfg) writeFileSync(path.join(distDir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  writeFileSync(path.join(distDir, '_headers'), headers);
  return { configWritten: cfg !== null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const { configWritten } = generate(process.env, dist);
  console.log(
    configWritten
      ? 'gen-runtime-files: wrote dist/config.json and dist/_headers'
      : 'gen-runtime-files: APP_* variables not set; wrote dist/_headers only (CSP connect-src is \'self\'). Provide config.json manually.',
  );
}
