# procurement-hub

A multi-team procurement management system. Members request items in a purchasing round (a *batch*), approvers review them, purchasers order them, and receivers check the goods on arrival — replacing shared spreadsheets with a structured, audited workflow.

Licensed under the [Apache License 2.0](LICENSE).

> **Status:** under development, no release yet. The MVP covers teams through receiving in both the API and the web UI. See [Feature status](#feature-status) and [First deployment](#first-deployment).

## Feature status

| Area | State |
|---|---|
| Sign-in with OIDC (Keycloak), access-token validation, `ADMIN_ROLES`, `PURCHASER_ROLES`, `RECEIVER_ROLES`, `ALLOWED_ROLES` | Works |
| Teams, members, subgroups, role-mapping rules (from `ROLE_MAPPINGS_FILE` or the API) that sync team membership from token claims | Works (API and web UI) |
| Batches and items with the review flow (approve, send back, reject, withdraw, resubmit, copy) | Works (API and web UI) |
| Vendors and reference exchange rates | Works (API and web UI) |
| Purchasing queue: approved items waiting to be ordered, marking items unpurchasable | Works (API and web UI) |
| Vendor orders: draft, place, cancel, lines that can mix items of several teams, cost entries (shipping, fees, discounts, refunds) allocated per team or line, cost calculation in the base currency with exact rounding | Works (API and web UI) |
| Receiving: deliveries and boxes, matching delivery lines to order lines, problems (damaged, wrong or missing goods) and their resolution, automatic batch completion, `GET /me/tasks` | Works (API and web UI) |
| Undo of review decisions, order placement, deliveries, matches, problem resolutions and closed lines, each with a reason | Works (API and web UI) |
| Audit log; timelines of batches and vendor orders | Works (API and web UI) |
| Notifications (in-app, email, Slack, Discord) | Not yet |
| CSV import and export | Not yet |
| Cost report | Not yet |
| Product lookup (part-finder): fills an item's name, vendor, SKU, price and URL from a SKU or product URL | Works (API and web UI) |

Configuration variables for the missing features (`SMTP_*`, `NOTIFY_DIGEST_WINDOW`, `WEBHOOK_ENCRYPTION_KEY`) are already validated at startup but have no effect yet; [`docs/configuration.md`](docs/configuration.md) marks them. The HTTP API is described in [`api/openapi.yaml`](api/openapi.yaml) (OpenAPI 3.1); responses carry `X-App-Commit`, and `X-App-Version` for release builds.

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
cp .env.example .env   # set OIDC_ISSUER, the *_ROLES and WEBHOOK_ENCRYPTION_KEY
                       # (head -c 32 /dev/urandom | base64)
docker compose up -d   # pulls ghcr.io/team6083/procurement-hub:latest
```

`PROCUREMENT_HUB_IMAGE` overrides the image. The compose file pulls the published image, and `latest` exists only after a `vX.Y.Z` release, so until then use `PROCUREMENT_HUB_IMAGE=ghcr.io/team6083/procurement-hub:main` or build the image locally (see [Container image](#container-image)) and run `PROCUREMENT_HUB_IMAGE=procurement-hub:local docker compose up -d`. Check it:

```sh
curl http://127.0.0.1:9090/healthz            # {"status":"ok"}
curl http://127.0.0.1:9090/readyz             # 200 {"status":"ready"} once OIDC is loaded and migrations have run
curl http://127.0.0.1:8080/api/v1/meta        # build info, base currency, supported currencies
docker compose down -v                        # stop and delete the data
```

`serve` starts only after `migrate` has exited successfully. `OIDC_ISSUER` must point at a running provider (for example a Keycloak realm set up as in [`docs/keycloak.md`](docs/keycloak.md)); no provider is bundled. If the issuer is unreachable, `serve` keeps running and retries OIDC discovery in the background: until it succeeds, `/readyz` answers 503 with `"check":"oidc"` and authenticated API requests get `503 upstream_unavailable`. The API listens on `127.0.0.1:8080` and the health and metrics endpoints on `127.0.0.1:9090`. `web/e2e/keycloak/realm-example.json` is a Keycloak realm import with the settings from the guide, localhost origins and throwaway test users; it is meant for trials and the end-to-end tests, not for production. The example MongoDB has no authentication and is meant for local trials only.

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
cp config.example.json public/config.json   # runtime config (gitignored); edit it, then:
npm run dev
```

## First deployment

Production runs the backend as the container image `ghcr.io/team6083/procurement-hub` and the SPA on Cloudflare. MongoDB and the OIDC provider (Keycloak) are not part of this repository.

1. **Keycloak.** Follow [`docs/keycloak.md`](docs/keycloak.md): the API and SPA clients, the audience mapper and the client roles. Put the roles in `ADMIN_ROLES`, `PURCHASER_ROLES` and `RECEIVER_ROLES`; a role left unset is held by nobody, so without `PURCHASER_ROLES` nobody can purchase.
2. **MongoDB.** Run a replica set (a single-node one is fine) with authentication enabled, a `MONGO_URI` that names the database in its path (add `authSource` if the user lives in another database), and regular backups (for example `mongodump --uri=... --gzip`) that you have restored at least once. The compose file in `examples/` has no authentication and is for trials only.
3. **Backend.** Set the variables from [`examples/.env.example`](examples/.env.example) (all variables: [`docs/configuration.md`](docs/configuration.md)). Run `procurement-hub migrate` as a one-off job with the image, then `serve`, as `examples/docker-compose.yml` does. `/readyz` on `METRICS_LISTEN_ADDR` (port `9090`, keep it off the public ingress) stays `503` until the migrations have run and OIDC discovery has loaded. Terminate TLS in front of the API on port `8080` with a reverse proxy or load balancer; the server speaks plain HTTP.
4. **Image.** `latest` and `X.Y.Z` tags exist only after a `vX.Y.Z` release; before that use `ghcr.io/team6083/procurement-hub:main` or `:sha-<7 chars>`.
5. **CORS.** `CORS_ALLOWED_ORIGINS` must contain the exact origin of the SPA (`https://host`, no path) and `FRONTEND_URL` its root URL. The same origin must be allowed in the Keycloak client (redirect and post-logout URIs, see [`web/README.md`](web/README.md)).
6. **SPA on Cloudflare.** Build with root directory `web`: `npm ci && npm run build:cloudflare`. Set the environment variable `APP_CONFIG` on the build to the whole `config.json` (`apiBaseUrl`, `oidc.authority`, `oidc.clientId`). Both URLs must be plain `https://` origins. Details, headers and the Workers or Pages setup are in [`web/README.md`](web/README.md#deploying-to-cloudflare).
7. **First check.** Sign in, open the browser console and look for Content-Security-Policy violations while browsing and signing out (the generated policy allows only the SPA, the API origin and the OIDC authority origin). Then confirm `GET <apiBaseUrl>/api/v1/meta` answers and that an admin can create a team.

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
  --build-arg COMMIT="$(git rev-parse HEAD)" \
  --build-arg BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  server
```

The image is distroless, runs as UID/GID `65532`, works with a read-only root filesystem, and exposes `8080` (API) and `9090` (health and metrics). It runs `serve` by default; pass `migrate` as the container command for the migration job. The build arguments `VERSION` (release tag without the `v`; leave empty for any other build), `COMMIT` and `BUILT_AT` (UTC ISO 8601) end up in `GET /api/v1/meta` as `build.version`, `build.commit` and `build.builtAt` (`null` when empty or unknown). `COMMIT` is always sent in the `X-App-Commit` response header, and `VERSION` in `X-App-Version` only when it is set. The Go version comes from `server/go.mod`; the Dockerfile's `GO_VERSION` default must match it, which CI checks.

The repository ships no deployment manifests; [`examples/`](examples/) has a Docker Compose setup for local trials.

## Configuration

### Backend (environment variables)

The backend is configured only through environment variables. [`docs/configuration.md`](docs/configuration.md) lists every variable with its default and format rules, and [`server/.env.example`](server/.env.example) is a starting point. Required: `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `MONGO_URI` (the database name is the URI path), `OIDC_ISSUER`, `OIDC_AUDIENCE`, `ADMIN_ROLES` and `WEBHOOK_ENCRYPTION_KEY`. Invalid settings are all reported at once and the process exits with status 1; on success one log line shows the effective configuration with secrets masked.

`ADMIN_ROLES` and `ALLOWED_ROLES` use oauth2-proxy's `--allowed-role` notation: a bare name is a Keycloak **realm role**, `<client id>:<role>` is a **client role**, and any match in the comma-separated list is enough. Examples: `ADMIN_ROLES=system-admin` (realm role), `ADMIN_ROLES=procurement-hub-api:admin` (client role), `ADMIN_ROLES=system-admin,procurement-hub-api:admin` (either). When `ALLOWED_ROLES` is set, callers that are neither system admins nor hold one of its roles get `403 missing_role` and no user record is created. The role must be present in the **access token**: the SPA client `procurement-hub-web` has *Full scope allowed* off and the roles are assigned to its dedicated scope; an Audience mapper adds `procurement-hub-api`. See [`docs/keycloak.md`](docs/keycloak.md).

Product lookup is off by default (`LOOKUP_PROVIDER=none`). To fill an item's name, vendor, SKU, price and URL from a SKU or product URL, set `LOOKUP_PROVIDER=partfinder` and `PARTFINDER_URL` (the root URL of a part-finder server the backend can reach); `PARTFINDER_PRICE_CURRENCY` (default `USD`) and `LOOKUP_TIMEOUT` (default `10s`) are optional. See [`docs/product-lookup.md`](docs/product-lookup.md).

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

The built SPA contains no environment-specific values. Before anything else it fetches `config.json` relative to its base path (with `cache: 'no-cache'`); when the file is missing or invalid it shows a configuration error page instead.

```json
{
  "apiBaseUrl": "https://api.example.org",
  "oidc": { "authority": "https://sso.example.org/realms/example", "clientId": "procurement-hub-web", "scope": "openid profile email" }
}
```

`oidc.scope` defaults to `openid profile email`. `npm run build` never writes `config.json`; provide it next to `index.html` yourself. For Cloudflare (Workers static assets or Pages), `npm run build:cloudflare` builds and then reads the whole config from the `APP_CONFIG` environment variable, validates it, and writes `dist/config.json`, `dist/_headers` (Content-Security-Policy and other security headers, with the API and OIDC origins derived from `APP_CONFIG`) and `wrangler.generated.jsonc`; an invalid `APP_CONFIG` fails the build. `VITE_BASE_PATH` is only needed for deployments under a sub-path. See [`web/README.md`](web/README.md).

The SPA detects a backend update by comparing its embedded commit with the backend's `X-App-Commit` header and blocks writes until the page is reloaded. The commit comes from the first available of `APP_COMMIT`, `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA`, or `git rev-parse HEAD`. In local development an unknown commit just skips the check, but a **production build (`NODE_ENV=production` or `CI=true`) fails when no commit can be determined**. The footer's build line (the UI library's `BuildInfo`) shows the SPA's commit and build time (`__APP_BUILT_AT__`, set when Vite starts or builds) and lists the API's build from the existing `GET /meta` query. It shows a release version only when the SPA and the API report the same commit, and then it is the API's `build.version`; the SPA never derives a version itself.

Silent token renewal uses the refresh token Keycloak issues for the Authorization Code flow (client setting *Use refresh tokens*, on by default). Do **not** request `offline_access`; see [docs/keycloak.md](docs/keycloak.md). The host must serve `index.html` for unknown paths (client-side routing); on Cloudflare this is `not_found_handling = "single-page-application"` (Workers) or the automatic SPA fallback (Pages), never a `_redirects` file.

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
web/                      React SPA (Vite); src/api holds the generated API types, see web/README.md
examples/                 docker-compose.yml for a local trial
docs/                     configuration.md, keycloak.md, product-lookup.md
.github/                  CI, release and Dependabot configuration
```

Notification, CSV and outbound-HTTP packages arrive with later milestones.

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
