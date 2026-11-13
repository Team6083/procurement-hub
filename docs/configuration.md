# Backend configuration

The backend (`server/`) is configured only through environment variables. [`server/.env.example`](../server/.env.example) lists all of them with safe placeholder values.

## Format rules

- **Empty means unset.** A variable set to an empty string (or only whitespace) gets its default. To turn a feature off, use its explicit value, such as `METRICS_LISTEN_ADDR=off`.
- **Durations** are Go durations (`300ms`, `30s`, `5m`, `1h30m`) plus a `d` unit of 24 hours, alone or combined (`90d`, `1.5d`, `1d12h`). Negative durations are rejected.
- **Booleans** accept the values of Go's `strconv.ParseBool`: `1`, `t`, `T`, `TRUE`, `true`, `True`, `0`, `f`, `F`, `FALSE`, `false`, `False`.
- **Lists** are comma-separated; whitespace around each entry is trimmed and empty entries are ignored.
- **Keys** are standard base64 and must decode to at least 32 bytes. Generate one with `head -c 32 /dev/urandom | base64`.
- **Addresses** are `host:port`; an empty host listens on all interfaces (`:8080`).

## Startup validation

At startup the service checks every variable. If anything is wrong it prints **all** problems to stderr, one per line, and exits with status 1. On success it logs one `info` line, `effective configuration`, with the configuration in effect. Secrets are masked: the user info (and secret-bearing options) of `MONGO_URI`, `WEBHOOK_ENCRYPTION_KEY` and `SMTP_PASSWORD` show as `***`. When `ALLOWED_ROLES` is unset, the line shows `"ALLOWED_ROLES":"unrestricted"`.

`procurement-hub migrate` reads only `MONGO_URI` and `LOG_LEVEL` and validates them the same way; it ignores every other variable, so it can run with the same environment as `serve` or a minimal one.

## Variables

### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `LISTEN_ADDR` | no | `:8080` | Listen address of the business API. |
| `METRICS_LISTEN_ADDR` | no | `:9090` | Listen address of `/healthz`, `/readyz` and `/metrics`. Keep it off the ingress. `off` disables this server, leaving no health-check endpoints for probes. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error` (lowercase). Any other value stops startup. |
| `SHUTDOWN_TIMEOUT` | no | `30s` | After SIGTERM, how long to wait for in-flight requests before exiting. |

### Frontend

| Variable | Required | Default | Description |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | yes | — | List of origins of the SPA (`https://host[:port]`), matched exactly. |
| `FRONTEND_URL` | yes | — | Root URL of the SPA, used to build links in notifications. Must be an absolute `http(s)` URL. |

### MongoDB

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB connection string (`mongodb://` or `mongodb+srv://`). The server must run as a replica set (a single-node replica set is fine). The **database name is the URI path** and is required, e.g. `mongodb://db.example.org:27017/procurement_hub?replicaSet=rs0`. When the user is defined in another database, add `authSource`. |

### Authentication and authorization

| Variable | Required | Default | Description |
|---|---|---|---|
| `OIDC_ISSUER` | yes | — | Issuer URL of the Keycloak realm, e.g. `https://sso.example.org/realms/example`. |
| `OIDC_AUDIENCE` | yes | — | Value the access token's `aud` claim must contain, e.g. `procurement-hub-api`. |
| `OIDC_CLOCK_SKEW` | no | `60s` | Tolerated clock difference when checking `exp` and `nbf`. |
| `OIDC_GROUPS_CLAIM` | no | `groups` | Dot path of the group list in the access token, used by role-mapping rules. |
| `ADMIN_ROLES` | yes | — | Roles that make a caller a system admin (role list syntax below). Required because without it nobody can create teams. |
| `ALLOWED_ROLES` | no | unrestricted | Roles allowed to use the service at all (role list syntax below). System admins are always allowed. Everyone else without a matching role gets `403 missing_role` on every authenticated endpoint, and no user record is created for them. When unset, everyone who can sign in may use the service. |
| `ROLE_MAPPINGS_FILE` | no | — | Path of a YAML file with managed role-mapping rules (see the README). |

**Role list syntax** (the same as oauth2-proxy's `--allowed-role`): a comma-separated list where any match is enough.

- A value without `:` is a Keycloak **realm role**, matched against `realm_access.roles`.
- `<client id>:<role>` is a **client role**, matched against `resource_access.<client id>.roles`. The value is split at the **first** `:`, so a realm role name cannot contain `:` (realm roles containing `:` are ignored); both parts must be non-empty.

Examples: `ADMIN_ROLES=procurement-hub-api:admin`, `ALLOWED_ROLES=staff,procurement-hub-api:user`. Roles are read from the current access token on every request. See [`keycloak.md`](keycloak.md) for getting the roles into the token.

**Token validation.** Every `/api/v1` request except `GET /api/v1/meta` needs a bearer access token. The signature is verified against the issuer's JWKS with a fixed allowlist of `RS256` (the token header never widens it; `none` and HS* are always rejected). `iss` must equal `OIDC_ISSUER`, `aud` must contain `OIDC_AUDIENCE`, `exp` (required) and `nbf` are checked with `OIDC_CLOCK_SKEW`, `sub` is required and `typ` must be `Bearer`, so ID and refresh tokens are rejected. Any failure returns `401 unauthenticated`.

### Secrets

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBHOOK_ENCRYPTION_KEY` | yes | — | Base64, at least 32 bytes decoded. Used only to encrypt team channel webhook URLs stored in the database. The AES-256-GCM key is derived from it with HKDF-SHA256 (info `procurement-hub webhook url v1`). Changing it makes stored webhook URLs unreadable. |

### Currencies

| Variable | Required | Default | Description |
|---|---|---|---|
| `BASE_CURRENCY` | no | `USD` | ISO 4217 code of actual costs. |
| `BASE_CURRENCY_DECIMALS` | no | ISO 4217 minor units | Overrides the number of decimals of the base currency, 0–4 (e.g. `0` for TWD in practice). |
| `SUPPORTED_CURRENCIES` | no | base currency only | List of ISO 4217 codes allowed for estimates and original-currency amounts. |

### Email notifications

| Variable | Required | Default | Description |
|---|---|---|---|
| `EMAIL_ENABLED` | no | `false` | Enables the email channel. |
| `SMTP_HOST` | when email is enabled | — | SMTP server host. |
| `SMTP_PORT` | when email is enabled | — | SMTP server port (1–65535). |
| `SMTP_USERNAME` | no | — | SMTP user name. |
| `SMTP_PASSWORD` | no | — | SMTP password. Never logged. |
| `SMTP_FROM` | when email is enabled | — | Sender address. |
| `SMTP_TLS_MODE` | no | `starttls` | `starttls`, `tls` (implicit TLS) or `none`. |
| `NOTIFY_DIGEST_WINDOW` | no | `5m` | Window in which notifications for the same recipient are merged into one digest. |

### Product lookup

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOOKUP_PROVIDER` | no | `none` | `none` or `partfinder`. |
| `PARTFINDER_URL` | when `LOOKUP_PROVIDER=partfinder` | — | Root URL of the part-finder HTTP server. |
| `PARTFINDER_PRICE_CURRENCY` | no | `USD` | ISO 4217 code assumed when a part-finder response has no currency. |
| `LOOKUP_TIMEOUT` | no | `10s` | Timeout of one lookup request. |
