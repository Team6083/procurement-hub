# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release section is used as the GitHub Release notes.

## [Unreleased]

### Added

- Subgroups have `aliases`, edited by team admins in the subgroup settings. Within a team, names and aliases together are unique (case-insensitive, inactive subgroups included); a clash returns 409 `subgroup_name_conflict`, which replaces the 422 `subgroup_exists` of subgroup names.
- The web UI footer shows the build through the UI library's `BuildInfo`: the SPA's commit and build time, the API's build in the details, and the API's release version only when the SPA and API are the same commit.
- Vendor order lines carry a read-only `productUrl`, the linked item's current product URL looked up when the order is read (empty for free-form lines or items without one) and `estimatedUnitPrice` (the item's current estimate, null without an item); the web UI links the line name to the product page and shows the estimate as the unit-price placeholder.
- `DELETE /items/{id}` deletes an item that was never reviewed (pending, `firstReviewedAt` null, batch draft, proposed or collecting; requester or team admin), writing an `item.deleted` audit event with the item's content; other items keep the withdraw flow (422 `item_not_deletable`). Items gain `firstReviewedAt`, set on the first review decision and never cleared. The web UI shows Delete instead of Withdraw on such items.
- `GET /audit` takes `order=asc|desc` (default `asc`); the batch and vendor order timelines in the web UI now show the newest event first, with an icon per event.
- Product lookup (API and web UI): the item form can fill the name, vendor, SKU, price and URL from a SKU or product URL, and marks the vendor as auto-filled. `GET /api/v1/lookup?q=` looks up a SKU or product URL through the configured provider (`LOOKUP_PROVIDER=partfinder` calls part-finder's `GET /api/v1/lookup`), maps the store name to a vendor by name or alias, and is limited to 30 requests per minute per user. See `docs/product-lookup.md`.
- Teams, members and role-mapping rules synchronized from OIDC token claims; batches and items with the review flow.
- Ordering (API only): team orders, external orders (vendor transactions) that can merge orders of several teams (the caller must be purchaser of every batch), marking items unpurchasable, and automatic `ordering` to `receiving`/`completed` batch transitions. Actual costs are computed in the base currency from the charged amount (or a reference rate, flagged provisional), with proportional or overridden allocation of shared costs and largest-remainder rounding so the amounts add up exactly to the charge. Adds migration `0002_order_indexes`; run `migrate` before starting this version.
- Receiving (API only): receiving records (`receivedQuantity` can never exceed the ordered quantity), item exceptions (`quantity_mismatch`, `wrong_item`, `damaged`) and their disposition by purchasers (`exchange` sends the item back to waiting, `accept` closes it as `accepted_short`, `cancel` as `not_obtained`, the last two with an optional refund), and `POST /orders/{id}/adjustments` for refunds and later cost corrections, which flow into the order's `adjustmentsBase` and `totalBase`. A batch in `receiving` completes automatically, in the same transaction, once every ordered item is closed and no exception is open. `GET /me/tasks` now fills `itemsToReceive` and `openExceptions`. Also adds `GET /items/{id}/receipts` and `GET /items/{id}/exceptions`; no new migration (the indexes already exist).
- Purchasing and receiving restructure (API and web UI): a purchasing queue of approved items, vendors and reference exchange rates, vendor orders (draft, place, cancel and restore, with lines for items or standalone costs, a ledger of manual entries and refunds, and base-currency cost calculation with shared-cost allocation), and receiving with deliveries (boxes), matching of delivery lines to order lines, problems and their resolution, closing and reopening short lines, and automatic batch status changes. Global roles `PURCHASER_ROLES` and `RECEIVER_ROLES`; every purchasing and receiving write can be undone with a reason. This replaces the earlier ordering and receiving API.
- `serve` (default) and `migrate` subcommands. Data migrations and indexes are versioned, applied only by `migrate` under a MongoDB lease, and `/readyz` stays 503 until they have run.
- `ALLOWED_ROLES` to restrict who may use the service (`403 missing_role`), alongside the required `ADMIN_ROLES`.
- Operations endpoints on a separate port (`METRICS_LISTEN_ADDR`): `/healthz`, `/readyz` and Prometheus `/metrics` with `procurement_hub_` metrics; JSON access log, `X-Request-ID` propagation, graceful shutdown with `SHUTDOWN_TIMEOUT`.
- Container image `ghcr.io/team6083/procurement-hub`: distroless, numeric non-root user, read-only root filesystem, version and commit injected at build time.
- CI for the server (gofmt, `go vet`, golangci-lint with staticcheck, race-enabled tests against a MongoDB replica set via testcontainers, govulncheck), the web app (generated API types check, typecheck, lint, tests, build, `npm audit`) and the image build; release workflow, Dependabot, and an `examples/docker-compose.yml` for local trials.
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/configuration.md` and `docs/keycloak.md`. The README lists which features work today and which (notifications, CSV import and export, cost report) are not implemented yet, and `docs/configuration.md` marks the settings that are validated but not used yet.
- Playwright end-to-end tests (`web/e2e`) of sign-in, access control, the team and batch flows, the update banner and a phone viewport, against Keycloak, MongoDB, the server image and the production SPA build; run in CI.

### Changed

- `GET /api/v1/meta` no longer returns top-level `version` and `commit`; the build is now `build: {version, commit, builtAt}`, each `null` when unknown. `X-App-Version` is sent only when the version is set (it is absent on builds that are not a release tag). The image takes a `BUILT_AT` build argument and `VERSION` is empty for builds that are not a release tag.
- The new-item form is lookup first when product lookup is enabled: it starts with a single product URL or SKU box and the fields unrelated to the product (quantity, priority, subgroup, purpose, notes), and shows the product fields after a lookup, on a lookup error, on "Fill in manually" or when the form is submitted with errors.
- The web app uses the team UI package `@team6083/ui` (public, on npm): the shared frame (pages as icon buttons with the current one highlighted, a color mode toggle, the account menu with the language and sign-out, a drawer on phones, the build in the footer) in a centered column, the team theme (gray by default, `brand` for emphasis only), and the home page rebuilt with a single page heading, a teams section with its count, and empty states.
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
- UI cleanup after review: dialogs have a consistent footer and size, the navigation has five items (an admin section holds the rest), and receiving is split into tabs for deliveries, box entry, matching and the receiving workbench.

### Fixed

- `PATCH /teams/{teamId}/subgroups/{id}` that changes nothing now returns 409 `version_conflict` when `If-Match` is stale, like the other writes, instead of 200.
- Subgroup and vendor names and aliases are compared with Unicode case folding and NFC normalization (so "ΟΔΟΣ" and "οδος", or a composed and a decomposed "é", clash), instead of plain lower-casing. A subgroup alias equal to the subgroup's own name is dropped instead of returning 409 `subgroup_name_conflict`, so renaming a subgroup to one of its aliases removes that alias; the 409, now only for clashes with another subgroup, carries the clashing value in `details.value`.

[Unreleased]: https://github.com/team6083/procurement-hub/commits/main
