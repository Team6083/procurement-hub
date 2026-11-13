// The runtime config.json contract (spec section 6.2). Plain zod with erasable-only TypeScript,
// so scripts/write-config.mjs can import it directly under Node's type stripping and the build
// and the app validate APP_CONFIG / config.json with the same rules.
import { z } from 'zod';

export const DEFAULT_SCOPE = 'openid profile email';

const scope = z
  .string()
  .trim()
  .min(1)
  .default(DEFAULT_SCOPE)
  .refine((s) => s.split(/\s+/).includes('openid'), { message: 'scope must include "openid"' })
  // Spec section 7.1: tokens live in memory only; offline tokens are never requested.
  .refine((s) => !s.split(/\s+/).includes('offline_access'), { message: 'scope must not include "offline_access"' });

export const configSchema = z.strictObject({
  apiBaseUrl: z.url({ protocol: /^https?$/ }),
  oidc: z.strictObject({
    authority: z.url({ protocol: /^https?$/ }),
    clientId: z.string().trim().min(1),
    scope,
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
