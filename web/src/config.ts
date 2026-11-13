import { z } from 'zod';
import { configSchema, type AppConfig } from './configSchema';

export { configSchema, type AppConfig };

/** The deploy base path ("/" or e.g. "/procurement/"), from VITE_BASE_PATH at build time. */
export const BASE_PATH: string = import.meta.env.BASE_URL;

/** Joins a root-relative app path ("/auth/callback") onto the base path. */
export function withBase(p: string, base = BASE_PATH): string {
  return `${base.replace(/\/+$/, '')}${p.startsWith('/') ? p : `/${p}`}`;
}

export type ConfigErrorKind = 'missing' | 'invalid';

export class ConfigError extends Error {
  readonly kind: ConfigErrorKind;
  constructor(kind: ConfigErrorKind, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.kind = kind;
  }
}

/** Validates an already-parsed JSON value. Throws ConfigError('invalid'). */
export function parseConfig(raw: unknown): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError('invalid', z.prettifyError(result.error));
  }
  return result.data;
}

/** Fetches config.json (relative to the base path) and validates it. Spec section 6.2. */
export async function loadConfig(fetchImpl: typeof fetch = fetch, base = BASE_PATH): Promise<AppConfig> {
  let res: Response;
  try {
    res = await fetchImpl(withBase('/config.json', base), { cache: 'no-cache' });
  } catch (e) {
    throw new ConfigError('missing', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new ConfigError('missing', `HTTP ${res.status}`);
  // An SPA fallback answers a missing config.json with index.html.
  if (/text\/html/i.test(res.headers.get('Content-Type') ?? '')) {
    throw new ConfigError('missing', 'config.json was answered with an HTML page (file not deployed?)');
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ConfigError('invalid', 'Response is not valid JSON');
  }
  return parseConfig(json);
}
