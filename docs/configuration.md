# Backend configuration

The backend (`server/`) is configured only through environment variables. [`server/.env.example`](../server/.env.example) lists all of them with safe placeholder values.

> **Implementation status.** Notifications (email, Slack, Discord), product lookup, CSV import/export and the cost report are not implemented yet (see the README). Their variables below are already read and validated at startup, so a bad value stops the service, but they have no other effect yet. The only visible effect today: `GET /api/v1/meta` reports `emailEnabled` and `lookupEnabled` from `EMAIL_ENABLED` and `LOOKUP_PROVIDER`. The same applies to `FRONTEND_URL` and `WEBHOOK_ENCRYPTION_KEY`, which are required and validated now but used only by the notification and webhook features. Each such section is marked below.

## Format rules

- **Empty means unset.** A variable set to an empty string (or only whitespace) gets its default. To turn a feature off, use its explicit value, such as `METRICS_LISTEN_ADDR=off`.
- **Durations** are Go durations (`300ms`, `30s`, `5m`, `1h30m`) plus a `d` unit of 24 hours, alone or combined (`90d`, `1.5d`, `1d12h`). Negative durations are rejected.
- **Booleans** accept the values of Go's `strconv.ParseBool`: `1`, `t`, `T`, `TRUE`, `true`, `True`, `0`, `f`, `F`, `FALSE`, `false`, `False`.
- **Lists** are comma-separated; whitespace around each entry is trimmed and empty entries are ignored.
- **Keys** are standard base64 (the padded `+` and `/` alphabet, not URL-safe) and must decode to at least 32 bytes. Generate one with `head -c 32 /dev/urandom | base64`.
- **Addresses** are `host:port` with a non-empty port; an empty host listens on all interfaces (`:8080`).
- **URLs** named "absolute `http(s)` URL" need a scheme of `http` or `https` and a host.
- **Currency codes** are three uppercase ASCII letters (ISO 4217 shape). Lowercase input is converted to uppercase for `BASE_CURRENCY`, `SUPPORTED_CURRENCIES` and `PARTFINDER_PRICE_CURRENCY`; the codes are not checked against the ISO list.
- **Values are trimmed.** Leading and trailing whitespace is removed from every variable except `SMTP_PASSWORD`.

## Startup validation

At startup the service checks every variable. If anything is wrong it prints **all** problems to stderr, one per line, and exits with status 1. On success it logs one `info` line, `effective configuration`, with the configuration in effect. Secrets are masked: the user info (and the secret-bearing options `authMechanismProperties` and `tlsCertificateKeyFilePassword`) of `MONGO_URI`, `WEBHOOK_ENCRYPTION_KEY` and `SMTP_PASSWORD` show as `***` (or empty when unset). When `ALLOWED_ROLES` is unset, the line shows `"ALLOWED_ROLES":"unrestricted"`.

`procurement-hub migrate` reads only `MONGO_URI` and `LOG_LEVEL` and validates them the same way; it ignores every other variable, so it can run with the same environment as `serve` or a minimal one.

## Variables

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `LISTEN_ADDR` | no | `:8080` | Listen address of the business API. |
| `METRICS_LISTEN_ADDR` | no | `:9090` | Listen address of `/healthz`, `/readyz` and `/metrics`. Keep it off the ingress. `off` disables this server, leaving no health-check endpoints for probes. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` (lowercase). Any other value stops startup. |
| `SHUTDOWN_TIMEOUT` | no | `30s` | After SIGTERM, how long to wait for in-flight requests before exiting. A duration; must not be negative. |

Logs are one JSON object per line on stdout. The business API (`LISTEN_ADDR`) and the operations server (`METRICS_LISTEN_ADDR`) are separate listeners: the container image exposes `8080` and `9090` for the defaults.

### Frontend

| Variable | Required | Default | Description |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | yes | — | List of origins of the SPA (`https://host[:port]`), matched exactly. Each entry needs a scheme and host and no path (a single trailing `/` is dropped); an entry like `https://host/app` stops startup. |
| `FRONTEND_URL` | yes | — | Root URL of the SPA, used to build links in notifications. Must be an absolute `http(s)` URL. Validated now; used once notifications exist. |

### MongoDB

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB connection string (`mongodb://` or `mongodb+srv://`). The server must run as a replica set (a single-node replica set is fine). The **database name is the URI path** and is required, e.g. `mongodb://db.example.org:27017/procurement_hub?replicaSet=rs0`. When the user is defined in another database, add `authSource`. Startup validation checks the scheme and the database name only; the driver checks the rest when connecting. `migrate` reads this variable too. |

### Authentication and authorization

| Variable | Required | Default | Description |
|---|---|---|---|
| `OIDC_ISSUER` | yes | — | Issuer URL of the Keycloak realm, e.g. `https://sso.example.org/realms/example`. Must be an absolute `http(s)` URL; use `https` outside local trials. |
| `OIDC_AUDIENCE` | yes | — | Value the access token's `aud` claim must contain, e.g. `procurement-hub-api`. |
| `OIDC_CLOCK_SKEW` | no | `60s` | Tolerated clock difference when checking `exp` and `nbf`. A duration; must not be negative. |
| `OIDC_GROUPS_CLAIM` | no | `groups` | Dot path of the group list in the access token, used by role-mapping rules. |
| `ADMIN_ROLES` | yes | — | Roles that make a caller a system admin (role list syntax below). Required because without it nobody can create teams. |
| `PURCHASER_ROLES` | no | — | Roles that make a caller a purchaser (role list syntax below): they handle vendor orders, the vendor list and problems for every team. Unset means nobody can purchase. System admins are **not** purchasers implicitly. |
| `RECEIVER_ROLES` | no | — | Roles that make a caller a receiver: they register and match deliveries for every team. Unset means only purchasers can receive. |
| `ALLOWED_ROLES` | no | unrestricted | Roles allowed to use the service at all (role list syntax below). System admins are always allowed. Everyone else without a matching role gets `403 missing_role` on every authenticated endpoint, and no user record is created for them. When unset, everyone who can sign in may use the service. |
| `ROLE_MAPPINGS_FILE` | no | — | Path of a YAML file with managed role-mapping rules (format below). Read at startup; an unreadable or invalid file stops startup. Unset means no managed rules. |

**Role list syntax** (the same as oauth2-proxy's `--allowed-role`): a comma-separated list where any match is enough.

- A value without `:` is a Keycloak **realm role**, matched against `realm_access.roles`.
- `<client id>:<role>` is a **client role**, matched against `resource_access.<client id>.roles`. The value is split at the **first** `:`, so a realm role name cannot contain `:` (realm roles containing `:` are ignored); both parts must be non-empty.

Examples: `ADMIN_ROLES=procurement-hub-api:admin`, `PURCHASER_ROLES=procurement-hub-api:purchaser`, `ALLOWED_ROLES=staff,procurement-hub-api:user`. Roles are read from the current access token on every request. See [`keycloak.md`](keycloak.md) for getting the roles into the token.

**Role-mapping rules file.** `ROLE_MAPPINGS_FILE` holds rules that map token claim values to team roles. At startup the rules are upserted by `id` and marked `managed` (read-only in the API), and managed rules that are no longer in the file are deleted. Rules created through the API are not managed and are left alone.

```yaml
rules:
  - id: all-team-members
    claim: groups
    pattern: /teams/*/members   # * matches exactly one path segment, captured as $1, $2, ...
    team: $1                    # target team slug; may reference captures
    role: member                # member or admin
  - id: purchasing-admins
    claim: roles                # realm and client roles; a client role is written <client id>:<role>
    pattern: procurement-hub-api:purchasing-admin
    team: purchasing
    role: admin
    # enabled: true             # optional, default true
    # description: free text    # optional
```

Every rule needs a unique `id`, a `claim` (`groups` or `roles`), a `pattern`, a `team` and a `role`. Unknown keys, a `*` that is not a whole path segment (`a*`), and a `$N` in `team` larger than the number of `*` in the pattern are errors. The `groups` claim is read from the token at `OIDC_GROUPS_CLAIM`.

**Token validation.** Every `/api/v1` request except `GET /api/v1/meta` needs a bearer access token. The signature is verified against the issuer's JWKS with a fixed allowlist of `RS256` (the token header never widens it; `none` and HS* are always rejected). `iss` must equal `OIDC_ISSUER`, `aud` must contain `OIDC_AUDIENCE`, `exp` (required) and `nbf` are checked with `OIDC_CLOCK_SKEW`, `sub` is required and `typ` must be `Bearer`, so ID and refresh tokens are rejected. Any failure returns `401 unauthenticated`. The OIDC discovery document is loaded in the background at startup and retried with backoff (1s doubling up to 30s) while the issuer is unreachable; until it has loaded, `/readyz` reports the `oidc` check as failing and requests with a bearer token get `503 upstream_unavailable` rather than `401`, since the token cannot be judged yet.

### Secrets (not used yet)

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBHOOK_ENCRYPTION_KEY` | yes | — | Base64, at least 32 bytes decoded. Used only to encrypt team channel webhook URLs stored in the database. The AES-256-GCM key is derived from it with HKDF-SHA256 (info `procurement-hub webhook url v1`). Changing it makes stored webhook URLs unreadable. Required and validated today; nothing is encrypted with it until team channel webhooks are implemented. |

### Currencies

| Variable | Required | Default | Description |
|---|---|---|---|
| `BASE_CURRENCY` | no | `USD` | ISO 4217 code of actual costs. |
| `BASE_CURRENCY_DECIMALS` | no | ISO 4217 minor units | Overrides the number of decimals of the base currency, an integer 0–4 (e.g. `0` for TWD in practice). The startup log shows `iso` when unset. |
| `SUPPORTED_CURRENCIES` | no | base currency only | List of currency codes allowed for item estimates, external order currencies and team reference rates. The list is used as given: the base currency is **not** added automatically, so include it when it should be allowed (for example `SUPPORTED_CURRENCIES=USD,EUR` with `BASE_CURRENCY=USD`). |

### Email notifications (not implemented yet)

Validated at startup only; no email is sent by this version.

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMAIL_ENABLED` | no | `false` | Enables the email channel. |
| `SMTP_HOST` | when email is enabled | — | SMTP server host. |
| `SMTP_PORT` | when email is enabled | — | SMTP server port (1–65535). Validated whenever it is set. |
| `SMTP_USERNAME` | no | — | SMTP user name. |
| `SMTP_PASSWORD` | no | — | SMTP password. Never logged. |
| `SMTP_FROM` | when email is enabled | — | Sender address. |
| `SMTP_TLS_MODE` | no | `starttls` | `starttls`, `tls` (implicit TLS) or `none`. Validated even when email is disabled. |
| `NOTIFY_DIGEST_WINDOW` | no | `5m` | Window in which notifications for the same recipient are merged into one digest. A duration; must not be negative. |

### Product lookup (not implemented yet)

Validated at startup only; no lookup is performed by this version.

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOOKUP_PROVIDER` | no | `none` | `none` or `partfinder`; anything else stops startup. Any value other than `none` makes `GET /api/v1/meta` report `lookupEnabled: true`, although no lookup endpoint exists yet. |
| `PARTFINDER_URL` | when `LOOKUP_PROVIDER=partfinder` | — | Root URL of the part-finder HTTP server. An absolute `http(s)` URL when set. |
| `PARTFINDER_PRICE_CURRENCY` | no | `USD` | Currency code assumed when a part-finder response has no currency. |
| `LOOKUP_TIMEOUT` | no | `10s` | Timeout of one lookup request. A duration; must not be negative. |
