# procurement-hub

A multi-team procurement management system. Members request items in a purchasing round (a *batch*), approvers review them, purchasers order them, and receivers check the goods on arrival — replacing shared spreadsheets with a structured, audited workflow.

Licensed under the [Apache License 2.0](LICENSE).

> **Status:** under development. Implemented so far: skeleton, identity & teams, batches & items (review flow). Ordering, receiving, notifications, product lookup, CSV and reports are not built yet.

## Architecture

- **Frontend** — a static React + TypeScript SPA (Vite), deployed separately from the backend. It signs in directly with an OIDC provider (Authorization Code + PKCE) and calls the API with bearer tokens.
- **Backend** — a stateless Go service exposing a REST API (`api/openapi.yaml`). Background jobs run in-process and are coordinated through MongoDB leases, so multiple replicas are supported.
- **MongoDB** — must run as a **replica set** (a single-node replica set is fine); the backend uses multi-document transactions.

Nothing in this repository is specific to an organization or deployment: every environment-specific value is supplied through configuration.

## Quick start

### Try it with Docker Compose

[`examples/docker-compose.yml`](examples/docker-compose.yml) runs a single-node MongoDB replica set, the one-off `migrate` job and the API server:

```sh
cd examples
cp .env.example .env   # set OIDC_ISSUER, ADMIN_ROLES, WEBHOOK_ENCRYPTION_KEY, ...
docker compose up -d
```

`serve` starts only after `migrate` has exited successfully. It loads the OIDC discovery document at startup and exits if the issuer is unreachable, so `OIDC_ISSUER` must point at a running provider (for example a Keycloak realm set up as in [`docs/keycloak.md`](docs/keycloak.md)); no provider is bundled. The API listens on `127.0.0.1:8080` and the health and metrics endpoints on `127.0.0.1:9090`. Set `PROCUREMENT_HUB_IMAGE` to use a locally built image. The example MongoDB has no authentication and is meant for local trials only.

### Development

Prerequisites: Go (the version in `server/go.mod`), Node.js (the version in `web/package.json` `engines`, currently 26), Docker (for the integration tests), a MongoDB replica set and an OIDC provider (e.g. Keycloak) with a public client for the SPA.

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
go run ./cmd/procurement-hub migrate   # apply data migrations and indexes first
go run ./cmd/procurement-hub           # serve (the default subcommand)

# Frontend (separate terminal)
cd web
npm ci
# provide runtime config (see below), then:
npm run dev
```

## Running the server

The binary (and the image) has two subcommands:

| Command | Purpose |
|---|---|
| `procurement-hub serve` (default) | Runs the API on `LISTEN_ADDR` (`:8080`), `/healthz`, `/readyz` and `/metrics` on `METRICS_LISTEN_ADDR` (`:9090`), and the background jobs. Stops gracefully on SIGTERM. |
| `procurement-hub migrate` | Applies pending data migrations and indexes, then exits 0 (or 1 naming the failed migration). Run it as a one-off job before rolling out a new version. |

### Data migrations

Schema changes and index creation are versioned migrations (`server/internal/migrations`), applied by `procurement-hub migrate`, never by `serve`. `migrate` runs every migration not yet recorded in the `migrations` collection, in order, recording each one; it exits 0 when all are done and 1 naming the migration that failed. A MongoDB lease (`migrationLease` collection) lets only one `migrate` run at a time; a second one waits for it and then finds nothing to do. Every migration is safe to re-run after a failure. `migrate` reads only `MONGO_URI` and `LOG_LEVEL`.

`serve` checks the records at startup and logs any pending migrations; until they are applied `/readyz` answers 503 with `"check":"migrations"`, and it turns ready on its own once `migrate` has run. Deploy a new version by running `migrate` as a one-off job with the new image, then rolling out `serve`.

## Testing

```sh
cd server
gofmt -l . && go vet ./... && golangci-lint run ./...
go test -race ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...

cd web
npm ci
npm run gen:api && git diff --exit-code src/api   # generated types up to date
npm run typecheck && npm run lint && npm test && npm run build
npm audit --audit-level=high
```

The server's integration and HTTP contract tests need a MongoDB replica set. By default each test package starts one `mongo:8` container through [testcontainers-go](https://golang.testcontainers.org/), so **Docker must be running**; without it those tests fail with a message saying so. Two environment variables change this:

- `TEST_MONGODB_URI` uses an existing replica set instead of a container, which is faster for repeated local runs, e.g. `TEST_MONGODB_URI='mongodb://localhost:27017/?replicaSet=rs0&directConnection=true' go test ./...`. The tests create and drop throwaway databases named `ph_*` on that server.
- `SKIP_INTEGRATION=1` skips the integration tests instead of failing them.

`HTTP_COVERAGE_STRICT=1` (set in CI) fails the run when an OpenAPI operation has no HTTP-level test. See [CONTRIBUTING.md](CONTRIBUTING.md) for the lint setup and the API contract rules.

## Container image

Release images are published to `ghcr.io/team6083/procurement-hub` (linux/amd64): `main` and `sha-<7 chars>` for every push to `main`, and `X.Y.Z`, `X.Y` and `latest` for every `vX.Y.Z` tag. To build one locally:

```sh
docker build -t procurement-hub:local \
  --build-arg GO_VERSION="$(sed -n 's/^go //p' server/go.mod)" \
  --build-arg VERSION=dev --build-arg COMMIT="$(git rev-parse HEAD)" \
  server
```

The image is distroless, runs as UID/GID `65532`, works with a read-only root filesystem, and exposes `8080` (API) and `9090` (health and metrics). It runs `serve` by default; pass `migrate` as the container command for the migration job. `VERSION` and `COMMIT` end up in the `X-App-Version` and `X-App-Commit` response headers. The Go version comes from `server/go.mod`; the Dockerfile's `GO_VERSION` default must match it, which CI checks.

The repository ships no deployment manifests; [`examples/`](examples/) has a Docker Compose setup for local trials.

## Configuration

### Backend (environment variables)

The backend is configured only through environment variables. [`docs/configuration.md`](docs/configuration.md) lists every variable with its default and format rules, and [`server/.env.example`](server/.env.example) is a starting point. Required: `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `MONGO_URI` (the database name is the URI path), `OIDC_ISSUER`, `OIDC_AUDIENCE`, `ADMIN_ROLES` and `WEBHOOK_ENCRYPTION_KEY`. Invalid settings are all reported at once and the process exits with status 1; on success one log line shows the effective configuration with secrets masked.

`ADMIN_ROLES` and `ALLOWED_ROLES` use oauth2-proxy's `--allowed-role` notation: a bare name is a Keycloak **realm role**, `<client id>:<role>` is a **client role**, and any match in the comma-separated list is enough. Examples: `ADMIN_ROLES=system-admin` (realm role), `ADMIN_ROLES=procurement-hub-api:admin` (client role), `ADMIN_ROLES=system-admin,procurement-hub-api:admin` (either). When `ALLOWED_ROLES` is set, callers that are neither system admins nor hold one of its roles get `403 missing_role` and no user record is created. The role must be present in the **access token**: the SPA client `procurement-hub-web` has *Full scope allowed* off and the roles are assigned to its dedicated scope; an Audience mapper adds `procurement-hub-api`. See [`docs/keycloak.md`](docs/keycloak.md).

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
  "oidc": { "authority": "https://sso.example.org/realms/example", "clientId": "procurement-hub-web", "scope": "openid profile email" }
}
```

`npm run build` writes `dist/config.json` and `dist/_headers` (including a Content-Security-Policy) when `APP_API_URL`, `APP_OIDC_AUTHORITY` and `APP_OIDC_CLIENT_ID` (and optionally `APP_OIDC_SCOPE`) are set. Otherwise only `_headers` is written with `connect-src 'self'`; supply `config.json` yourself and adjust the CSP `connect-src` to include your API and OIDC origins.

The SPA detects a backend update by comparing its embedded commit with the backend's `X-App-Commit` header and blocks writes until the page is reloaded. The commit comes from the first available of `APP_COMMIT`, `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA`, or `git rev-parse HEAD`. In local development an unknown commit just skips the check, but a **production build (`NODE_ENV=production` or `CI=true`) fails when no commit can be determined**.

Silent token renewal uses the refresh token Keycloak issues for the Authorization Code flow (client setting *Use refresh tokens*, on by default). Do **not** request `offline_access`; see [docs/keycloak.md](docs/keycloak.md). The host must serve `index.html` for unknown paths (client-side routing).

## Repository layout

```
api/openapi.yaml          API contract (OpenAPI 3.1); source of truth for handlers and frontend types
server/                   Go module github.com/team6083/procurement-hub/server
  cmd/procurement-hub/    entry point: serve (default) and migrate
  internal/config/        environment variable parsing and validation
  internal/auth/          JWT validation, principal, role matching and mapping sync
  internal/authz/         permission checks
  internal/domain/        entities, state machines, money (pure logic)
  internal/store/         MongoDB repositories and transactions
  internal/migrations/    versioned data migrations and indexes
  internal/service/       use cases coordinating domain, store and audit
  internal/httpapi/       hand-written chi handlers and middleware
  internal/ops/           /healthz, /readyz, /metrics, access log, request id
  internal/jobs/          lease-based background jobs
  internal/audit/         audit records
  Dockerfile, .env.example, .golangci.yml
web/                      React SPA (Vite); src/api holds the generated API types
examples/                 docker-compose.yml for a local trial
docs/                     configuration.md, keycloak.md
.github/                  CI, release and Dependabot configuration
```

Notification, product lookup, CSV and outbound-HTTP packages arrive with later milestones.

## 12-factor self-check

The service follows the twelve-factor methodology with one exception, for the frontend: it reads a runtime `config.json` and is built once per environment, with no environment values in the bundle.

| Factor | How procurement-hub meets it |
|---|---|
| I. Codebase | One repository; the backend image and the SPA are released from the same Git tag. |
| II. Dependencies | `go.mod`/`go.sum` and `package-lock.json` pin every dependency; the image is a static binary on distroless. |
| III. Config | The backend reads only environment variables, validated at startup; the SPA reads `/config.json` at runtime. |
| IV. Backing services | MongoDB, the OIDC provider and the SMTP server are attached only through configuration. |
| V. Build, release, run | CI builds one image per commit; configuration is supplied at run time. The SPA is built per environment (the exception above). |
| VI. Processes | `serve` is stateless; the in-memory token-sync cache only saves reads and is rebuilt from MongoDB. |
| VII. Port binding | The API binds `LISTEN_ADDR`, health and metrics bind `METRICS_LISTEN_ADDR`. |
| VIII. Concurrency | Run more replicas; background jobs coordinate through MongoDB leases. |
| IX. Disposability | On SIGTERM `/readyz` turns 503, in-flight requests finish within `SHUTDOWN_TIMEOUT`, job leases are released. |
| X. Dev/prod parity | Tests, CI and the compose example all use `mongo:8` as a replica set, as in production. |
| XI. Logs | One JSON object per line on stdout (`log/slog`). |
| XII. Admin processes | Migrations run as `procurement-hub migrate`, a one-off job using the same image. |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and [SECURITY.md](SECURITY.md) to report a vulnerability. Notable changes are listed in [CHANGELOG.md](CHANGELOG.md).
