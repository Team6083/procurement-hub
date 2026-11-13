# Keycloak setup

procurement-hub works with any OIDC provider that issues JWT access tokens; this guide uses Keycloak terms. The example origins are `https://app.example.org` (SPA) and `https://sso.example.org/realms/example` (realm); replace them with your own.

Two clients are involved, named after the application:

| Client | Purpose |
|---|---|
| `procurement-hub-web` | The SPA. A public client that signs users in. |
| `procurement-hub-api` | The API. It only serves as the token audience and holds the application's client roles (for example `admin`, `user`); nobody signs in with it. |

The sections below follow a fixed order: client, mapper, roles, token lifetimes, post-logout redirect URI.

## 1. Client

Create the API client `procurement-hub-api` with every flow switched off (Client authentication off, Standard flow off, Direct access grants off). It needs no redirect URIs.

Create the SPA client `procurement-hub-web`:

| Setting | Value |
|---|---|
| Client authentication | Off (public client) |
| Standard flow | On (Authorization Code) |
| Direct access grants, Implicit flow | Off |
| Proof Key for Code Exchange (PKCE) method | `S256` |
| Valid redirect URIs | `https://app.example.org/auth/callback` (add `http://localhost:5173/auth/callback` for local development) |
| Web origins | `https://app.example.org` |
| Use refresh tokens | On (the default) |
| **Full scope allowed** | **Off** (*Client scopes → procurement-hub-web-dedicated → Scope*) |

With Full scope allowed off, the access token carries only the roles explicitly assigned to the client's dedicated scope (section 3), not every role the user has in the realm.

The SPA keeps tokens **in memory only**, so every full page load goes through a redirect to Keycloak. Keycloak's own SSO session makes this a fast bounce without a password prompt. The SPA requests the scope `openid profile email` (configurable in `config.json`, but never add `offline_access`; see section 4).

The backend accepts only **access tokens** for its API: it verifies the signature against the realm's JWKS with an asymmetric algorithm (RS256, the realm default; `none` and HS* are always rejected), and checks that `iss` equals `OIDC_ISSUER`, `aud` contains `OIDC_AUDIENCE`, `exp`/`nbf` are valid (within `OIDC_CLOCK_SKEW`), `sub` is present and `typ` is `Bearer`. ID tokens and refresh tokens are rejected.

## 2. Mapper

Add these mappers to the dedicated scope of `procurement-hub-web` (*Client scopes → procurement-hub-web-dedicated → Mappers*):

| Mapper type | Settings |
|---|---|
| **Audience** | *Included Client Audience* = `procurement-hub-api`, *Add to access token* = on. This puts `procurement-hub-api` in `aud`; set `OIDC_AUDIENCE=procurement-hub-api`. |
| **Group Membership** | *Token Claim Name* = `groups` (the same as `OIDC_GROUPS_CLAIM`), *Full group path* = on, *Add to access token* = on. Needed only if role-mapping rules match groups. |

With *Full group path* on, a group `members` under `teams/alpha` appears as `/teams/alpha/members`, which matches the role-mapping pattern `/teams/*/members` (`ROLE_MAPPINGS_FILE` or the admin UI).

Realm and client roles reach the access token through Keycloak's default `roles` client scope (`realm_access.roles` and `resource_access.<client id>.roles`); no extra role mapper is needed.

## 3. Roles

Create the application's client roles on `procurement-hub-api` (for example `admin` for system admins and `user` for people allowed to use the service). Then assign each role the token should carry to the **dedicated scope** of `procurement-hub-web` (*Client scopes → procurement-hub-web-dedicated → Scope → Assign role*). Because Full scope allowed is off, a role that is not assigned there never appears in the token, even if the user has it. Grant the roles to users or groups as usual.

`ADMIN_ROLES` and `ALLOWED_ROLES` use the notation of oauth2-proxy's `--allowed-role`:

| Value | Meaning |
|---|---|
| `system-admin` | a **realm role** named `system-admin` (`realm_access.roles`) |
| `procurement-hub-api:admin` | the **client role** `admin` of client `procurement-hub-api` (`resource_access.procurement-hub-api.roles`) |
| `system-admin,procurement-hub-api:admin` | several values, comma-separated; **any** match is enough |

The first colon separates client ID from role, so a realm role name cannot contain `:` (such realm roles are ignored). A bare name never matches a client role and vice versa.

- `ADMIN_ROLES` (required), for example `procurement-hub-api:admin`: system admins can administer every team but are not implicitly team members and hold no batch roles.
- `ALLOWED_ROLES` (optional), for example `procurement-hub-api:user`: who may use the service at all. When set, a caller who is neither a system admin nor holds one of these roles gets `403 missing_role` on every API call, and no user record is created for them. When unset, everyone who can sign in may use the service.

Roles are read from the current access token on every request and never stored, so a role change takes effect with the next access token.

## 4. Token lifetimes

- **Access token lifespan: 5 minutes** (*Realm settings → Tokens → Access Token Lifespan*). The SPA renews tokens in the background with the refresh token (no iframe), and group changes reach the application within one token lifetime.
- **Refresh token rotation on**: *Realm settings → Tokens → Revoke Refresh Token* on, *Refresh Token Max Reuse* = 0. The SPA always keeps the newest refresh token.
- **No `offline_access`.** Do not request it and do not add it to the client's scopes. Offline tokens are long-lived and not bound to the SSO session, which is unsuitable for a credential held by a browser.
- How long a user may stay idle is governed by the realm's **SSO Session Idle** and **SSO Session Max**. When renewal fails (session expired or revoked) the SPA falls back to a normal sign-in redirect.

## 5. Post-logout redirect URI

Sign-out sends the user to Keycloak's end-session endpoint with `post_logout_redirect_uri` set to the SPA root: the origin plus the base path, **with the trailing slash** (`https://app.example.org/`, or `https://app.example.org/procurement/` under `VITE_BASE_PATH=/procurement/`). Register exactly that value on `procurement-hub-web`; Keycloak compares it literally, so `https://app.example.org` without the slash fails sign-out with "Invalid redirect uri":

| Setting | Value |
|---|---|
| Valid post logout redirect URIs | `https://app.example.org/` (add `http://localhost:5173/` for local development) |

## Reference realm

The end-to-end tests import a realm configured exactly as above: [`web/e2e/keycloak/realm-example.json`](../web/e2e/keycloak/realm-example.json) (Keycloak's realm export format, for plain-http localhost origins and with test users). It shows the settings as JSON keys: `fullScopeAllowed: false`, the two mappers under the client's `protocolMappers` (its dedicated scope), the role assignments to the dedicated scope under `clientScopeMappings`, `pkce.code.challenge.method` and `post.logout.redirect.uris` under `attributes`, and `accessTokenLifespan`, `revokeRefreshToken` and `refreshTokenMaxReuse` on the realm.

## Checklist

- [ ] `procurement-hub-api` client exists (no flows) and holds the application's client roles
- [ ] `procurement-hub-web`: public client, Standard flow, PKCE `S256`, redirect URIs and web origins set
- [ ] Full scope allowed **off**; required roles assigned to the dedicated scope
- [ ] Audience mapper adds `procurement-hub-api` to the access token; `OIDC_AUDIENCE=procurement-hub-api`
- [ ] Group Membership mapper adds `groups` to the access token (if role-mapping rules use groups)
- [ ] `ADMIN_ROLES` (and optionally `ALLOWED_ROLES`) name roles that appear in the access token
- [ ] Access token lifespan 5 minutes; refresh token rotation on; **no** `offline_access`
- [ ] Post-logout redirect URI registered, with the trailing slash
