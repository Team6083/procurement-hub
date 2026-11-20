import { ConfigError, createRuntimeConfig } from '@team6083/ui';
import { z } from 'zod';
import { configSchema, type AppConfig } from './configSchema';

export { configSchema, type AppConfig };

/** The deploy base path ("/" or e.g. "/procurement/"), from VITE_BASE_PATH at build time. */
export const BASE_PATH: string = import.meta.env.BASE_URL;

/** Joins a root-relative app path ("/auth/callback") onto the base path. */
export function withBase(p: string, base = BASE_PATH): string {
  return `${base.replace(/\/+$/, '')}${p.startsWith('/') ? p : `/${p}`}`;
}

/** Validates an already-parsed JSON value. Throws ConfigError listing every problem. */
export function parseConfig(raw: unknown): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(z.prettifyError(result.error).split('\n'));
  }
  return result.data;
}

/** Loads config.json (relative to the base path) before the app starts and shows the config error page if it fails. Spec section 6.2. */
export const { RuntimeConfigProvider, useRuntimeConfig } = createRuntimeConfig<AppConfig>({ parse: parseConfig, basePath: BASE_PATH });
