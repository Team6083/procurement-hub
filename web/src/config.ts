import { z } from 'zod';

export const configSchema = z.object({
  apiBaseUrl: z.url(),
  oidc: z.object({
    authority: z.url(),
    clientId: z.string().min(1),
    scope: z.string().min(1).default('openid profile email'),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

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

/** Fetches /config.json from the app's own origin and validates it. */
export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  let res: Response;
  try {
    res = await fetchImpl('/config.json', { cache: 'no-store' });
  } catch (e) {
    throw new ConfigError('missing', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new ConfigError('missing', `HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ConfigError('invalid', 'Response is not valid JSON');
  }
  return parseConfig(json);
}

let current: AppConfig | undefined;

export function setConfig(c: AppConfig): void {
  current = c;
}

export function getConfig(): AppConfig {
  if (!current) throw new Error('Config accessed before it was loaded');
  return current;
}
