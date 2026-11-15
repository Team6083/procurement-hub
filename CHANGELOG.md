# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release section is used as the GitHub Release notes.

## [Unreleased]

### Added

- Teams, members and role-mapping rules synchronized from OIDC token claims; batches and items with the review flow.
- Ordering (API only): team orders, external orders (vendor transactions) that can merge orders of several teams (the caller must be purchaser of every batch), marking items unpurchasable, and automatic `ordering` to `receiving`/`completed` batch transitions. Actual costs are computed in the base currency from the charged amount (or a reference rate, flagged provisional), with proportional or overridden allocation of shared costs and largest-remainder rounding so the amounts add up exactly to the charge. Adds migration `0002_order_indexes`; run `migrate` before starting this version.
- Receiving (API only): receiving records (`receivedQuantity` can never exceed the ordered quantity), item exceptions (`quantity_mismatch`, `wrong_item`, `damaged`) and their disposition by purchasers (`exchange` sends the item back to waiting, `accept` closes it as `accepted_short`, `cancel` as `not_obtained`, the last two with an optional refund), and `POST /orders/{id}/adjustments` for refunds and later cost corrections, which flow into the order's `adjustmentsBase` and `totalBase`. A batch in `receiving` completes automatically, in the same transaction, once every ordered item is closed and no exception is open. `GET /me/tasks` now fills `itemsToReceive` and `openExceptions`. Also adds `GET /items/{id}/receipts` and `GET /items/{id}/exceptions`; no new migration (the indexes already exist).
- `serve` (default) and `migrate` subcommands. Data migrations and indexes are versioned, applied only by `migrate` under a MongoDB lease, and `/readyz` stays 503 until they have run.
- `ALLOWED_ROLES` to restrict who may use the service (`403 missing_role`), alongside the required `ADMIN_ROLES`.
- Operations endpoints on a separate port (`METRICS_LISTEN_ADDR`): `/healthz`, `/readyz` and Prometheus `/metrics` with `procurement_hub_` metrics; JSON access log, `X-Request-ID` propagation, graceful shutdown with `SHUTDOWN_TIMEOUT`.
- Container image `ghcr.io/team6083/procurement-hub`: distroless, numeric non-root user, read-only root filesystem, version and commit injected at build time.
- CI for the server (gofmt, `go vet`, golangci-lint with staticcheck, race-enabled tests against a MongoDB replica set via testcontainers, govulncheck), the web app (generated API types check, typecheck, lint, tests, build, `npm audit`) and the image build; release workflow, Dependabot, and an `examples/docker-compose.yml` for local trials.
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/configuration.md` and `docs/keycloak.md`.
- Playwright end-to-end tests (`web/e2e`) of sign-in, access control, the team and batch flows, the update banner and a phone viewport, against Keycloak, MongoDB, the server image and the production SPA build; run in CI.

### Changed

- Repository layout is now `server/` (Go module `github.com/team6083/procurement-hub/server`) and `web/`.
- Environment variables follow the project standard names and format rules, are all validated at startup, and the effective configuration is logged with secrets masked. `WEBHOOK_ENCRYPTION_KEY` is turned into the encryption key with HKDF-SHA256.
- Access tokens are checked against an RS256 allowlist and must have `typ` `Bearer` and an expiry.
- API error codes are lowercase `snake_case` and listed in the OpenAPI `ErrorCode` enum.
- The SPA requires Node.js 26 (`engines`) and production builds fail without a commit SHA.
- `serve` no longer exits when OIDC discovery fails at startup: it retries in the background, `/readyz` stays 503 (`oidc`) and authenticated requests get `503 upstream_unavailable` until discovery loads.
- `GET /me` returns `locale: null` until the user chooses a language; the SPA then follows the browser language.
- The SPA uses Chakra UI v3 instead of Mantine. Light/dark follows the operating system; selects are native for phones, and the header has a menu on narrow screens.
- A user without an allowed role sees only a "no access" page with a sign-out button once the API answers `403 missing_role`.
- Item table columns sort ascending on the first click; editing a batch no longer rewrites a deadline that has seconds when the deadline field was not changed.

[Unreleased]: https://github.com/team6083/procurement-hub/commits/main
