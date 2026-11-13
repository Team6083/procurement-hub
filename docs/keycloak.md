# Keycloak setup

procurement-hub works with any OIDC provider; this guide uses Keycloak terms. Replace the example URLs with your own.

## 1. The SPA client

Create one **public** client (for example `procurement-hub`):

| Setting | Value |
|---|---|
| Client authentication | Off (public client) |
| Standard flow | On (Authorization Code) |
| Direct access grants / implicit flow | Off |
| Proof Key for Code Exchange (PKCE) method | `S256` |
| Valid redirect URIs | `https://app.example.org/auth/callback` (add `http://localhost:5173/auth/callback` for local development) |
| Valid post logout redirect URIs | `https://app.example.org` |
| Web origins | `https://app.example.org` |

The SPA keeps tokens **in memory only**, so every full page load goes through a redirect to Keycloak. Keycloak's own SSO session makes this a fast bounce without a password prompt.

## 2. Refresh tokens (silent renewal)

Access tokens are expected to be short-lived (about 5 minutes; *Realm settings → Tokens → Access Token Lifespan*). The SPA renews them in the background with a refresh token and no iframe.

- Keycloak issues a refresh token for the Authorization Code flow by default. Keep the client setting **Use refresh tokens** switched **on** (it is on by default). No extra scope is needed.
- Enable **refresh token rotation** (*Revoke Refresh Token* in the realm token settings, with *Refresh Token Max Reuse* = 0). The SPA always stores the newest refresh token.
- **Do not request `offline_access`.** Offline tokens are not bound to the SSO session and are long-lived, which is unsuitable for a credential held by a browser. The default scope is `openid profile email`; it can be changed with `APP_OIDC_SCOPE` at build time or in `config.json`, but do not add `offline_access`.
- How long a user may stay idle is governed by the realm's **SSO Session Idle** and **SSO Session Max** settings. When renewal fails (session expired or revoked) the SPA falls back to a normal sign-in redirect.

## 3. Token contents

The backend verifies the **access token** (signature via JWKS, `iss`, `exp`, `nbf`, and `aud`) and reads identity and roles from it.

### Audience

`OIDC_AUDIENCE` must appear in the access token's `aud` claim. If the SPA client's own ID is the audience, add an **Audience** mapper to the client's dedicated scope (*Included Client Audience* = the SPA client, *Add to access token* = on). Otherwise use a separate audience client scope.

### Groups (team membership)

Role-mapping rules (`ROLE_MAPPINGS_FILE` or the admin UI) turn token claims into team memberships. For groups, add a **Group Membership** mapper (token claim name `groups`, *Add to access token* = on). With *Full group path* on, a group `members` under `teams/alpha` appears as `/teams/alpha/members`, which matches the pattern `/teams/*/members`. Use the same claim name as `OIDC_GROUPS_CLAIM` (default `groups`).

### System admins (realm role or client role)

`ADMIN_ROLES` follows the notation of oauth2-proxy's `--allowed-role` for the Keycloak provider:

| Value | Meaning |
|---|---|
| `system-admin` | a **realm role** named `system-admin` (token claim `realm_access.roles`) |
| `procurement-hub:admin` | the **client role** `admin` of client `procurement-hub` (token claim `resource_access.procurement-hub.roles`) |
| `system-admin,procurement-hub:admin` | several values, comma-separated; **any** match grants system admin |

The first colon separates client ID from role, so a realm role name cannot contain `:`. A bare name never matches a client role and vice versa.

The role must be present in the **access token**. With Keycloak's default `roles` client scope this requires the client's **Full scope allowed** setting (*Client → Client scopes → dedicated scope → Scope*), or a *User Client Role* / *User Realm Role* mapper. Realm roles are read from `realm_access.roles`; client roles from `resource_access`.

System admins can administer every team (see the specification, §8.1) but are not implicitly team members and hold no batch roles.

## 4. Checklist

- [ ] Public client, Standard flow, PKCE `S256`, correct redirect URIs and web origins
- [ ] *Use refresh tokens* on, rotation enabled, **no** `offline_access`
- [ ] Short access-token lifespan (~5 minutes); SSO Session Idle/Max set to the idle time you accept
- [ ] `aud` in the access token contains `OIDC_AUDIENCE`
- [ ] Groups mapper adds the `groups` claim to the access token
- [ ] The admin role (realm or client role) appears in the access token and is listed in `ADMIN_ROLES`
