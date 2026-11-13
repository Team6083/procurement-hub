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

Prerequisites: Go (see `server/go.mod`), Node.js 22+, a MongoDB replica set, and an OIDC provider (e.g. Keycloak) with a public client for the SPA.

```sh
# Backend
cd server
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export FRONTEND_URL=http://localhost:5173
export WEBHOOK_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)
export MONGO_URI='mongodb://localhost:27017/procurement_hub?replicaSet=rs0'
export OIDC_ISSUER=https://sso.example.org/realms/example
export OIDC_AUDIENCE=procurement-hub-api
export ADMIN_ROLES=procurement-hub-api:admin
go run ./cmd/procurement-hub   # subcommands: serve (default), migrate

# Frontend (separate terminal)
cd web
npm ci
# provide runtime config (see below), then:
npm run dev
```

### Tests

```sh
cd server && go vet ./... && go test ./...
# Integration tests need a MongoDB replica set and are skipped without it:
TEST_MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0' go test ./...

cd web && npm run typecheck && npm run lint && npm test && npm run build
```

Integration tests create and drop throwaway databases named `ph_test_*` on the server you point them at.

### Container image

```sh
docker build -f server/Dockerfile server
```

The image runs `serve` by default; pass `migrate` as the container command to run migrations as a one-off job.

## Configuration

### Backend (environment variables)

The backend is configured only through environment variables. [`docs/configuration.md`](docs/configuration.md) lists every variable with its default and format rules, and [`server/.env.example`](server/.env.example) is a starting point. Required: `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `MONGO_URI` (the database name is the URI path), `OIDC_ISSUER`, `OIDC_AUDIENCE`, `ADMIN_ROLES` and `WEBHOOK_ENCRYPTION_KEY`. Invalid settings are all reported at once and the process exits with status 1; on success one log line shows the effective configuration with secrets masked.

`ADMIN_ROLES` and `ALLOWED_ROLES` use oauth2-proxy's `--allowed-role` notation: a bare name is a Keycloak **realm role**, `<client id>:<role>` is a **client role**, and any match in the comma-separated list is enough. Examples: `ADMIN_ROLES=system-admin` (realm role), `ADMIN_ROLES=procurement-hub-api:admin` (client role), `ADMIN_ROLES=system-admin,procurement-hub-api:admin` (either). The role must be present in the **access token**; see [`docs/keycloak.md`](docs/keycloak.md).

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
server/                 Go service (cmd/procurement-hub, internal/…)
web/                    React SPA
deploy/, docs/          Helm chart and operator docs (later milestones)
```
