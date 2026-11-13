# procurement-hub

A multi-team procurement management system. Members request items in a purchasing round (a *batch*), approvers review them, purchasers order them, and receivers check the goods on arrival — replacing shared spreadsheets with a structured, audited workflow.

Licensed under the Apache License 2.0.

> **Status:** under development. Implemented so far: skeleton, identity & teams, batches & items (review flow). Ordering, receiving, notifications, product lookup, CSV and reports are not built yet.

## Architecture

- **Frontend** — a static React + TypeScript SPA (Vite), deployed separately from the backend. It signs in directly with an OIDC provider (Authorization Code + PKCE) and calls the API with bearer tokens.
- **Backend** — a stateless Go service exposing a REST API (`api/openapi.yaml`). Background jobs run in-process and are coordinated through MongoDB leases, so multiple replicas are supported.
- **MongoDB** — must run as a **replica set** (a single-node replica set is fine); the backend uses multi-document transactions.

Nothing in this repository is specific to an organization or deployment: every environment-specific value is supplied through configuration.

## Quick start (development)

Prerequisites: Go (see `backend/go.mod`), Node.js 22+, a MongoDB replica set, and an OIDC provider (e.g. Keycloak) with a public client for the SPA.

```sh
# Backend
cd backend
export APP_FRONTEND_ORIGINS=http://localhost:5173
export APP_FRONTEND_URL=http://localhost:5173
export APP_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
export MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0'
export OIDC_ISSUER_URL=https://sso.example.org/realms/example
export OIDC_AUDIENCE=procurement-hub
go run ./cmd/server

# Frontend (separate terminal)
cd frontend
npm ci
# provide runtime config (see below), then:
npm run dev
```

### Tests

```sh
cd backend && go vet ./... && go test ./...
# Integration tests need a MongoDB replica set and are skipped without it:
TEST_MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0' go test ./...

cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

Integration tests create and drop throwaway databases named `ph_test_*` on the server you point them at.

## Configuration

### Backend (environment variables)

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_HTTP_ADDR` | no | `:8080` | API listen address |
| `APP_METRICS_ADDR` | no | `:9090` | Metrics and health listen address |
| `APP_FRONTEND_ORIGINS` | yes | — | Comma-separated exact origins allowed by CORS |
| `APP_FRONTEND_URL` | yes | — | Base URL used to build links in notifications |
| `APP_BASE_CURRENCY` | no | `USD` | ISO 4217 code for actual costs |
| `APP_SUPPORTED_CURRENCIES` | no | base currency | Currencies allowed for estimates |
| `APP_ENCRYPTION_KEY` | yes | — | Base64 32-byte key (AES-256-GCM for secrets in the DB) |
| `MONGODB_URI` | yes | — | Must point to a replica set |
| `MONGODB_DATABASE` | no | `procurement_hub` | |
| `OIDC_ISSUER_URL` | yes | — | OIDC issuer (e.g. a Keycloak realm URL) |
| `OIDC_AUDIENCE` | yes | — | Value that must be present in the access token `aud` |
| `OIDC_GROUPS_CLAIM` / `OIDC_ROLES_CLAIM` | no | `groups` / `realm_access.roles` | Dot paths into the access token |
| `OIDC_ADMIN_ROLE` | no | `system-admin` | Role(s) granting system admin, comma-separated; any match is enough. A bare name is a Keycloak **realm role** (`realm_access.roles`); `<client id>:<role>` is a **client role** (`resource_access.<client id>.roles`) — the same notation as oauth2-proxy's `--allowed-role` |
| `ROLE_MAPPINGS_FILE` | no | — | YAML file of managed role-mapping rules |

The full list (SMTP, lookup provider, digest window, …) is in the specification; a dedicated `docs/configuration.md` will follow with the release milestone.

Examples: `OIDC_ADMIN_ROLE=system-admin` (realm role), `OIDC_ADMIN_ROLE=procurement-hub:admin` (client role), `OIDC_ADMIN_ROLE=system-admin,procurement-hub:admin` (either). The role must be present in the **access token**: with Keycloak's default `roles` client scope this requires "Full scope allowed" on the client, or a client-roles mapper. Role names containing `:` cannot be used as realm roles.

Role-mapping rules map token claim values to team roles. Example `ROLE_MAPPINGS_FILE`:

```yaml
rules:
  - id: all-team-members
    claim: groups
    pattern: /teams/*/members   # * matches exactly one path segment, captured as $1
    team: $1
    role: member
```

### Frontend (runtime configuration)

The built SPA contains no environment-specific values. At startup it fetches `/config.json` from its own origin:

```json
{
  "apiBaseUrl": "https://api.example.org",
  "oidc": { "authority": "https://sso.example.org/realms/example", "clientId": "procurement-hub", "scope": "openid profile email" }
}
```

`npm run build` writes `dist/config.json` and `dist/_headers` (including a Content-Security-Policy) when `APP_API_URL`, `APP_OIDC_AUTHORITY` and `APP_OIDC_CLIENT_ID` (and optionally `APP_OIDC_SCOPE`) are set. Otherwise only `_headers` is written with `connect-src 'self'`; supply `config.json` yourself and adjust the CSP `connect-src` to include your API and OIDC origins.

The SPA detects a backend update by comparing its embedded commit with the backend's `X-App-Commit` header and blocks writes until the page is reloaded. The commit comes from the first available of `APP_COMMIT`, `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA`, or `git rev-parse HEAD`. In local development an unknown commit just skips the check, but a **production build (`NODE_ENV=production` or `CI=true`) fails when no commit can be determined**.

Silent token renewal uses the refresh token Keycloak issues for the Authorization Code flow (client setting *Use refresh tokens*, on by default). Do **not** request `offline_access`; see [docs/keycloak.md](docs/keycloak.md). The host must serve `index.html` for unknown paths (client-side routing).

## Repository layout

```
api/openapi.yaml        API contract (source of truth for generated frontend types)
backend/                Go service (cmd/server, internal/…)
frontend/               React SPA
deploy/, docs/          Helm chart and operator docs (later milestones)
```
