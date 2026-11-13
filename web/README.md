# procurement-hub web

React 19 + Vite single-page app. It talks only to the procurement-hub API and to the OIDC provider (Authorization Code flow with PKCE).

## Setup

```sh
npm ci
cp config.example.json public/config.json   # gitignored; edit for your environment
npm run dev                                 # http://localhost:5173
```

The only build-time variable is `VITE_BASE_PATH` (the deployed base path, default `/`; set it only for a sub-path deployment such as `/procurement/`). Everything else is read at runtime from `config.json`, served next to `index.html`, so one build works for any environment.

| `config.json` field | Meaning |
| --- | --- |
| `apiBaseUrl` | Origin of the procurement-hub API (requests go to `<apiBaseUrl>/api/v1/...`) |
| `oidc.authority` | OIDC issuer URL (for Keycloak, the realm URL) |
| `oidc.clientId` | The SPA's public client id, e.g. `procurement-hub-web` |
| `oidc.scope` | Optional, default `openid profile email`. Must include `openid`; `offline_access` is rejected |

Unknown fields are rejected. If `config.json` is missing or invalid, the app shows a configuration error page and does nothing else.

The OIDC client must allow `<site origin><base path>auth/callback` as a redirect URI and `<site origin><base path>` as a post-logout redirect URI; the site origin must also be in the API's `CORS_ALLOWED_ORIGINS`. See [`../docs/keycloak.md`](../docs/keycloak.md).

## Commands

```sh
npm run dev               # Vite dev server
npm run build             # typecheck + vite build -> dist/ (no config.json)
npm run build:cloudflare  # build, then write dist/config.json, dist/_headers and wrangler.generated.jsonc from APP_CONFIG
npm run preview           # serve dist/ locally
npm run typecheck
npm run lint              # ESLint + typescript-eslint + react-hooks
npm test                  # Vitest
npm run gen:api           # regenerate src/api/schema.d.ts from ../api/openapi.yaml
```

A production build (`NODE_ENV=production`, `CI=true`, or any `vite build`) fails when no commit SHA can be found. The SHA is embedded for the frontend/backend version check and comes from the first of `APP_COMMIT`, `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA` and `git rev-parse HEAD`. When building from a source archive without `.git`, set `APP_COMMIT`.

## Deploying to Cloudflare

Set the environment variable `APP_CONFIG` to the whole `config.json` and run `npm ci && npm run build:cloudflare` with root directory `web`. `scripts/write-config.mjs` validates `APP_CONFIG` with the same schema the app uses and fails the build if it is missing or invalid. It writes:

- `dist/config.json`: the validated config (with the default scope filled in).
- `dist/_headers` (built by `scripts/csp.mjs`), for every path:
  - `Content-Security-Policy`: `default-src 'none'`; `script-src 'self' https://static.cloudflareinsights.com`; `style-src 'self' 'unsafe-inline'`; `connect-src 'self'` plus the API origin, the OIDC authority origin and `https://cloudflareinsights.com`; `img-src 'self'`; `font-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
  - `/assets/*` (hashed file names) additionally gets `Cache-Control: public, max-age=31536000, immutable`. `index.html` and `config.json` keep Cloudflare's default caching.
- `wrangler.generated.jsonc` (gitignored): a Workers static-assets config with `assets.not_found_handling = "single-page-application"` and a fixed `compatibility_date`. Deploy with `npx wrangler deploy -c wrangler.generated.jsonc`; set `WORKERS_DEV=false` to turn off the `*.workers.dev` URL.

The CSP only accepts plain `https://host[:port]` URLs for `apiBaseUrl` and `oidc.authority` (no userinfo, query, fragment, wildcard or special characters), so `build:cloudflare` cannot target an `http://` or `localhost` API; the dev server never applies this CSP. `style-src` allows `'unsafe-inline'` because the UI library injects `<style>` elements at runtime and a static host cannot issue per-response nonces. Any new external origin (fonts, images, scripts) must be added in `scripts/csp.mjs`.

On Cloudflare Pages, leave out `404.html` so the automatic SPA fallback applies, and do not add a `_redirects` file. After deploying, check that `curl -sI https://<site>/config.json` and `curl -sI -H 'Sec-Fetch-Mode: navigate' https://<site>/batches` both show the headers above, and that the browser console shows no CSP violations while signing in, browsing and signing out.

Other static hosts: run `npm run build`, put your `config.json` in `dist/`, serve `index.html` for unknown paths, and send equivalent headers.

## Sign-in

`src/auth/` uses `oidc-client-ts` with `react-oidc-context`:

- Authorization Code flow with PKCE (S256). Tokens are kept in memory only (`InMemoryWebStorage`), so a full page reload redirects to the provider, whose SSO session usually signs the user straight back in. The current route travels in the OIDC `state` and is restored after `/auth/callback`.
- Tokens are renewed in the background with the refresh token (`automaticSilentRenew`); the iframe fallback is disabled. A failed renew starts a new sign-in.
- The API client sends `Authorization: Bearer <access token>`. On `401` it renews once and retries once; if that still fails it starts a new sign-in. A second such failure within a minute shows a "session not accepted" page instead of redirecting again, so a misconfigured API cannot cause a redirect loop.
- Sign-out calls `signoutRedirect` with `post_logout_redirect_uri` set to the app root.
- When any API call answers `403 missing_role` (in practice `GET /me` right after sign-in), the whole app is replaced by a "no access" page with only a sign-out button (`src/auth/AccessGate.tsx`).

## UI

Components are Chakra UI v3. `src/components/ui/` holds the theme (`theme.ts`: a `brand` palette and a few semantic tokens), the provider and small wrappers used across pages (dialog, form field, native select, checkbox list, table shell, tooltip). Light/dark mode follows the operating system (`color-mode.ts` sets the `light`/`dark` class on `<html>`; there is no inline script, so the CSP needs no script hash). No web fonts are loaded. Component tests render through `src/test/render.tsx` (`renderUI`) or `src/test/fakeApi.tsx` (`renderWithApi`, a real API client over a fake `fetch`).

## Routing

`src/router.tsx` defines the routes for react-router 7 in data mode (`createBrowserRouter`, no framework mode or SSR), with `basename` taken from `VITE_BASE_PATH`. The router is created only after sign-in, once the OIDC callback has restored the original URL. Route paths and `Link` targets are app paths without the base path (`/batches/1`); build dynamic ones with `src/paths.ts`, and use `RouteAnchor`/`RouteButton` from `src/components/RouteLinks.tsx` for links styled by the UI library. Query strings are kept as they are; a page that reads one parses `useSearchParams()` with zod. `src/router.test.tsx` covers every route, the base path and `/auth/callback`.

## Language

The UI is available in English (`en`) and Traditional Chinese (`zh-TW`). The first language comes from the browser's preferences (`zh*` gives `zh-TW`, `en*` gives `en`, anything else `en`). Choosing a language in the app saves it to `/me`, and the saved choice then wins over the browser's preferences. `/me` returns `locale: null` until the user chooses, so an unchosen profile never overrides the browser. `src/i18n/locales.test.ts` checks that both languages have the same keys.
