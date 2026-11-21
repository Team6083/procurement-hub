# Contributing

Thanks for helping with procurement-hub. This guide covers the development setup, the checks CI runs, and the rules for changing the API.

## Development setup

You need:

- **Go**: the version in [`server/go.mod`](server/go.mod). It is the only place the Go version is written; CI and the Dockerfile read it from there.
- **Node.js**: the version range in [`web/package.json`](web/package.json) `engines` (currently Node 26). There is no `.nvmrc`; use your version manager's support for `engines`, or install it directly.
- **Docker**: the server's integration tests start MongoDB in a container.
- For running the app: a MongoDB replica set and an OIDC provider. [`examples/docker-compose.yml`](examples/docker-compose.yml) gives you MongoDB; [`docs/keycloak.md`](docs/keycloak.md) describes the provider setup.

The [README](README.md#development) shows how to start the backend and the SPA. [`docs/configuration.md`](docs/configuration.md) lists every environment variable.

## Checks

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the following on every pull request and push to `main`. Run them locally before opening a pull request.

Vulnerability checks are split in two. A pull request fails only on vulnerabilities it introduces (`actions/dependency-review-action`, high severity and above). `govulncheck` and `npm audit --audit-level=high` scan the whole dependency tree on pushes to `main` and weekly, so a newly published advisory does not block unrelated pull requests. Run them locally when you change dependencies.

### Server (`server/`)

```sh
gofmt -l .                      # must print nothing
go vet ./...
golangci-lint run ./...         # v2.15.0, configured in server/.golangci.yml (staticcheck enabled)
HTTP_COVERAGE_STRICT=1 go test -race ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...   # main and weekly CI only
```

Use the golangci-lint version pinned in `ci.yml` (`GOLANGCI_LINT_VERSION`), for example from the [official release binaries](https://github.com/golangci/golangci-lint/releases) or with `go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0 run ./...`.

**Tests need Docker.** Integration and HTTP tests start a `mongo:8` single-node replica set per package with testcontainers-go and fail with a clear message when Docker is unavailable. `TEST_MONGODB_URI` points them at an existing replica set instead (they create and drop `ph_*` databases there), and `SKIP_INTEGRATION=1` skips them; do not rely on skipping for a pull request.

### Web (`web/`)

```sh
npm ci
npm run gen:api && git diff --exit-code src/api   # generated API types must be committed
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high      # main and weekly CI only
```

**`package-lock.json` is the source of truth for versions.** `package.json` uses caret ranges (`^`), so always install with `npm ci`, never `npm install`, and commit the lockfile with any dependency change. Two exceptions stay pinned: `@team6083/ui` is an exact version (see "Web UI package" below), and `typescript` is `~6.0.x` (see `.github/dependabot.yml`).

End-to-end tests (Playwright against Keycloak, MongoDB, the server image and the production build; needs Docker):

```sh
npx playwright install chromium   # once
npm run e2e:ci                    # start the environment, run the tests, tear it down
```

`npm run e2e` runs the tests against an environment already started with `npm run e2e:up` (stop it with `npm run e2e:down`). [`web/README.md`](web/README.md#end-to-end-tests) describes the environment and the test users. CI runs the suite in the `e2e` job on `main` only (it is slow, so pull requests skip it) and uploads the HTML report, traces and service logs when it fails. Add a flow to `web/e2e/` when a change affects sign-in, permissions or a multi-user workflow; keep tests independent of run order across files, use unique names per run, and wait with Playwright assertions instead of sleeps.

**Keep the e2e tests in step with the UI.** Selectors use visible labels, button names and status text, so renaming a label, changing a button or reworking a filter breaks them; update `web/e2e` in the same pull request. The tests inside one file run serially and build on each other, so one failure makes the rest report "did not run": fix the first failure and rerun to see the next. Selector conventions: the page title is the `h1` (`PageHeader`); match text with `exact: true`, because an `EmptyState` title is also a heading (for example "No batches found." matches `name: 'Batches'`); the update banner has the test id `app-outdated-banner`; the account menu button is named after the user.

`npm run build:cloudflare` additionally needs `APP_CONFIG` (see [`web/README.md`](web/README.md)). Lint is ESLint with typescript-eslint and the full `eslint-plugin-react-hooks` recommended set; `react-hooks/exhaustive-deps` is an error.

A production build (`NODE_ENV=production` or `CI=true`) fails when no commit SHA can be found; it uses the first of `APP_COMMIT`, `CF_PAGES_COMMIT_SHA`, `WORKERS_CI_COMMIT_SHA` and `git rev-parse HEAD`.

### Image

CI also builds the image from [`server/Dockerfile`](server/Dockerfile) without pushing it, and checks that the Dockerfile's `GO_VERSION` default matches `server/go.mod`. When you bump Go in `go.mod`, update that default too.

## API contract rules

[`api/openapi.yaml`](api/openapi.yaml) is the single source of truth for the HTTP API. Handlers in `server/internal/httpapi` are written by hand and tests keep them in line with it:

1. **Change the contract first.** Every new or changed endpoint, parameter, request or response field, status code and error code goes into `openapi.yaml` in the same pull request.
2. **Route coverage.** A test fails if a registered route is missing from `openapi.yaml` or an operation in `openapi.yaml` has no route.
3. **HTTP-level tests.** Add tests in `server/internal/app/http_*_test.go`. They go through the real router and middleware with JWTs signed by the test JWKS, and validate every request and response against `openapi.yaml` with kin-openapi. With `HTTP_COVERAGE_STRICT=1` an operation that no HTTP test exercises fails the run. Service-level tests alone do not cover an endpoint. A test that deliberately sends an invalid request sets `skipRequestValidation`.
4. **Regenerate frontend types.** Run `npm run gen:api` in `web/` and commit `web/src/api`.
5. **OpenAPI 3.1 nullability.** Write nullable fields as `type: [string, "null"]` or with `oneOf: [..., {type: "null"}]`; an empty schema `{}` is not treated as nullable.
6. **Error codes** are lowercase `snake_case` and listed in the `ErrorCode` enum; add frontend translations for new codes in both `en` and `zh-TW`.

## Web UI package

The web app's frame, theme and standard pages come from the package `@team6083/ui` on npm. Its design rules are in `DESIGN.md` inside the package (`node_modules/@team6083/ui/DESIGN.md`):

- One `PageHeader` per page, with the status as its badge; sections use `SectionHeader` with the count as a badge and actions on the right.
- An empty list is an `EmptyState`, never a line of grey text; the first load shows skeletons, not a spinner.
- Grey by default; `brand` only for emphasis. Use semantic tokens (`fg.muted`, `brand.solid`), never hard-coded colours.
- One solid button per card or dialog.

Do not edit shared components inside this repository or in `node_modules`, and do not point the dependency at a local tarball (CI cannot install it). Change the package in its own repository, publish a prerelease, and update the exact version here. Needs specific to this app go in `web/src`.

## Gotchas

- **Amounts are strings without fixed decimals** (`"12.5"`, `"100"`). Never compare them as strings; only CSV export uses a fixed number of decimals.
- **"Edited since it was returned"** is `item.version > review.atVersion`. Do not compare timestamps: the review write itself is a few microseconds later than `review.at`, so the comparison is always true.
- **`omitempty` has no effect on `bson.ObjectID`**: an unset id is written as `"000000000000000000000000"`.

## Repository rules

- Documentation in the repository (README, `docs/`) is written in English. Code, identifiers, API fields and error codes are English.
- Nothing organization-specific goes into the repository: no organization names, domains, OIDC provider addresses, account IDs, role-mapping rules, secrets or cluster manifests. Use `example.org` placeholders. The GitHub owner name appears only in the Go module path, the image name and repository links.
- No deployment manifests (Kubernetes or otherwise); deployments live in a separate repository.
- Add a line to the `Unreleased` section of [`CHANGELOG.md`](CHANGELOG.md) for user-visible changes.
- Write commit subjects in the imperative mood ("Add …", "Fix …").

## Releases

Maintainers release by moving the `Unreleased` changelog entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading and pushing a `vX.Y.Z` tag. The release workflow publishes the image (`X.Y.Z`, `X.Y`, `latest`), creates the GitHub Release from that changelog section, and force-updates the `release` branch to the tagged commit so Git-integrated frontend hosting builds the released code. Image signing and SBOMs are enabled by setting the repository variable `ENABLE_SIGNING` to `true`.
