# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release section is used as the GitHub Release notes.

## [Unreleased]

## [0.1.0] - 2026-11-27

### Added

- Subgroups have `aliases`, edited by team admins in the subgroup settings. Within a team, names and aliases together are unique (compared with Unicode case folding and NFC normalization, inactive subgroups included). An alias equal to the subgroup's own name is dropped, so renaming a subgroup to one of its aliases removes that alias; a clash with another subgroup returns 409 `subgroup_name_conflict` with the clashing value in `details.value`, which replaces the 422 `subgroup_exists` of subgroup names. Responses always list `aliases` (an empty list for subgroups stored before aliases existed), and the `team.subgroup_added` audit event records the aliases a subgroup is created with.
- The web UI footer shows the build through the UI library's `BuildInfo`: the SPA's commit and build time, the API's build in the details, and the API's release version only when the SPA and API are the same commit.
- Vendor order lines carry a read-only `productUrl`, the linked item's current product URL looked up when the order is read (empty for free-form lines or items without one) and `estimatedUnitPrice` (the item's current estimate, null without an item); the web UI links the line name to the product page and shows the estimate as a hint while the unit price is typed (an empty price reads "not set").
- `DELETE /items/{id}` deletes an item that was never reviewed (pending, `firstReviewedAt` null, batch draft, proposed or collecting; requester or team admin), writing an `item.deleted` audit event with the item's content; other items keep the withdraw flow (422 `item_not_deletable`). Items gain `firstReviewedAt`, set on the first review decision and never cleared. The web UI shows Delete instead of Withdraw on such items.
- `GET /audit` takes `order=asc|desc` (default `asc`); the batch and vendor order timelines in the web UI now show the newest event first, with an icon per event.
- Product lookup (API and web UI): the item form can fill the name, vendor, SKU, price and URL from a SKU or product URL, and marks the vendor as auto-filled. `GET /api/v1/lookup?q=` looks up a SKU or product URL through the configured provider (`LOOKUP_PROVIDER=partfinder` calls part-finder's `GET /api/v1/lookup`), maps the store name to a vendor by name or alias, and is limited to 30 requests per minute per user. See `docs/product-lookup.md`.
- Teams, members and role-mapping rules synchronized from OIDC token claims; batches and items with the review flow.
- Purchasing and receiving restructure (API and web UI): a purchasing queue of approved items, vendors and reference exchange rates, vendor orders (draft, place, cancel and restore, with lines for items or standalone costs, a ledger of manual entries and refunds, and base-currency cost calculation with shared-cost allocation), and receiving with deliveries (boxes), matching of delivery lines to order lines, problems and their resolution, closing and reopening short lines, and automatic batch status changes. Global roles `PURCHASER_ROLES` and `RECEIVER_ROLES`; every purchasing and receiving write can be undone with a reason. This replaces the earlier ordering and receiving API.
- `serve` (default) and `migrate` subcommands. Data migrations and indexes are versioned, applied only by `migrate` under a MongoDB lease, and `/readyz` stays 503 until they have run.
- `ALLOWED_ROLES` to restrict who may use the service (`403 missing_role`), alongside the required `ADMIN_ROLES`.
- Operations endpoints on a separate port (`METRICS_LISTEN_ADDR`): `/healthz`, `/readyz` and Prometheus `/metrics` with `procurement_hub_` metrics; JSON access log, `X-Request-ID` propagation, graceful shutdown with `SHUTDOWN_TIMEOUT`.
- Container image `ghcr.io/team6083/procurement-hub`: distroless, numeric non-root user, read-only root filesystem, version and commit injected at build time.
- CI for the server (gofmt, `go vet`, golangci-lint with staticcheck, race-enabled tests against a MongoDB replica set via testcontainers, govulncheck), the web app (generated API types check, typecheck, lint, tests, build, `npm audit`) and the image build; release workflow, Dependabot, and an `examples/docker-compose.yml` for local trials.
- `SECURITY.md`, `CONTRIBUTING.md`, `docs/configuration.md` and `docs/keycloak.md`. The README lists which features work today and which (notifications, CSV import and export, cost report) are not implemented yet, and `docs/configuration.md` marks the settings that are validated but not used yet.
- Playwright end-to-end tests (`web/e2e`) of sign-in, access control, the team and batch flows, the update banner and a phone viewport, against Keycloak, MongoDB, the server image and the production SPA build; run in CI.

### Changed

- Vendor order amounts are null value by value instead of per order, and the API returns the server's results rather than intermediates. A line's `lineC` (quantity x unit price in the order currency, exact, never rounded; replaces the earlier `cost` and `shared`) needs only that line's unit price; `totals.linesC`, `checkoutC` and `originalC` need every line priced; `totals.factor`, `targetBase` and each line's `costBase` and `sharedBase` need those and a conversion; `separateBase`, `totalBase` and `totals.netBase` also need every separate entry's base amount. `totals.incomplete` lists every missing input. A cancelled order keeps `lineC` and the order-currency totals and has no base-currency values.
- Provisional flags sit where they apply: `totals.factorProvisional`, a line's `costProvisional` (the factor came from a reference rate) and `separateProvisional` (a separate entry allocated to it did), and each cost entry's computed `amountBase` (its base-currency amount, separate entries only) and `provisional`. `totals.provisional` stays true when any of them is.
- Changing the currency of a draft vendor order (`PUT /vendor-orders/{id}`) is refused with 422 `currency_change_blocked` (`details.entries`) while a with-checkout cost entry exists; otherwise the unit prices of all lines are cleared and the old prices are kept in the audit event. Separate entries are not affected.
- One rule for grouping items by vendor: an item belongs to a vendor only through `vendorId`. A typed vendor name is matched to an active vendor's name or alias (case-insensitive) only when the item is saved (create, edit) or looked up, never when reading; adding an alias later does not move existing items. The purchasing queue and `GET /me/tasks` use the same grouping: a deactivated vendor keeps its own group (`inactive`), items without a vendor form the last "other" group, and `VendorTask` gains `vendorId` and `inactive`, `QueueGroup` gains `inactive`.
- The web app is on `@team6083/ui` 0.3.0: `TitleBar` headings, `DataTable` with phone cards, people shown as avatars (name on hover), item priorities in colour, details behind icons (received/expected problems, provisional amounts), an editable unit price, a menu for the batch actions on phones, a link to the vendor's website in the vendor list, and the account avatar from the OIDC `picture` claim. The home page groups items to purchase by vendor, including vendor aliases. Traditional Chinese wording uses 「明細」 and 「筆」 for lines and counts.
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
- Subgroup settings (web UI): the aliases field refuses more than 50 aliases or an alias over 200 characters before saving; the table shows each alias as its own badge; a `subgroup_name_conflict` names the clashing name or alias.

### Fixed

- The Content-Security-Policy allows `https:` images, so the picture from the OIDC `picture` claim shows in the account menu instead of being blocked.
- The team members table writes each member's name next to the avatar on wide screens too (the e-mail address is on hover); only phone cards and narrow lists keep the avatar alone.
- `PATCH /teams/{teamId}/subgroups/{id}` that changes nothing now returns 409 `version_conflict` when `If-Match` is stale, like the other writes, instead of 200.
- Vendor names and aliases are compared with Unicode case folding and NFC normalization (so "ΟΔΟΣ" and "οδος", or a composed and a decomposed "é", clash), the same key as subgroups, instead of plain lower-casing. Vendor search (`GET /vendors?q=`) folds the same way, so "ss" finds "ß".

[Unreleased]: https://github.com/team6083/procurement-hub/compare/v0.1.0...main
[0.1.0]: https://github.com/team6083/procurement-hub/releases/tag/v0.1.0
