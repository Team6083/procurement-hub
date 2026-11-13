// `npm run build:cloudflare` step (spec section 6.2): reads the whole runtime config from the
// APP_CONFIG environment variable, validates it, and writes
//   dist/config.json            the runtime config the SPA fetches at startup
//   dist/_headers               CSP and hardening headers (scripts/csp.mjs)
//   wrangler.generated.jsonc    Workers static-assets config (not committed)
// Any problem fails the build instead of shipping a site that only shows the config error page.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { configSchema } from '../src/configSchema.ts';
import { buildHeaders } from './csp.mjs';

// Bump deliberately after checking the Workers changelog; never derived from the build date.
export const COMPATIBILITY_DATE = '2026-11-01';

/** Parses and validates APP_CONFIG; returns {config, headers} or throws with a readable message. */
export function prepare(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('APP_CONFIG is not set: put the whole config.json in this environment variable.');
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`APP_CONFIG is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const result = configSchema.safeParse(json);
  if (!result.success) throw new Error(`APP_CONFIG is invalid:\n${z.prettifyError(result.error)}`);
  const config = result.data;
  let headers;
  try {
    headers = buildHeaders(config);
  } catch (e) {
    throw new Error(`APP_CONFIG: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return { config, headers };
}

/** Wrangler config for `npx wrangler deploy -c wrangler.generated.jsonc`. */
export function buildWrangler(env) {
  const workersDev = !['false', '0', 'off'].includes(String(env.WORKERS_DEV ?? '').trim().toLowerCase());
  return {
    name: 'procurement-hub',
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: workersDev,
    assets: { directory: './dist', not_found_handling: 'single-page-application' },
  };
}

/** Writes the three files; `root` is the web/ directory. */
export function writeConfig(env, root) {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    throw new Error('dist/index.html not found: run `npm run build` first (or use `npm run build:cloudflare`).');
  }
  const { config, headers } = prepare(env.APP_CONFIG);
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(path.join(dist, '_headers'), headers);
  writeFileSync(path.join(root, 'wrangler.generated.jsonc'), JSON.stringify(buildWrangler(env), null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    writeConfig(process.env, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    console.log('write-config: wrote dist/config.json, dist/_headers and wrangler.generated.jsonc');
  } catch (e) {
    console.error(`write-config: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
