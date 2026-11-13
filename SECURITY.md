# Security policy

## Supported versions

Only the latest release (the newest `vX.Y.Z` tag and the `latest` image) receives security fixes. The backend and the SPA are released together from the same tag and are not guaranteed to work across versions, so upgrade both.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it privately through GitHub's [private vulnerability reporting](https://github.com/team6083/procurement-hub/security/advisories/new) for this repository.

Include what you can of:

- the affected version or commit, and the component (`server`, `web`, the image);
- steps to reproduce, or a proof of concept;
- the impact you expect (for example data exposure across teams, privilege escalation, denial of service).

We aim to acknowledge a report within a few working days, keep you informed while we investigate, and credit you in the advisory unless you prefer otherwise. Please give us a reasonable time to release a fix before disclosing the issue.

## Scope

In scope: the Go service in `server/`, the SPA in `web/`, the container image, and the CI and release workflows in `.github/`.

Out of scope: vulnerabilities in your own deployment's configuration (for example an OIDC provider, MongoDB or reverse proxy set up insecurely), and findings that need an already compromised administrator account or host.

## Security design notes

- Every authorization decision is made by the backend; the SPA only hides what the user cannot do.
- Access tokens are validated against the configured OIDC issuer (signature algorithm allowlist, `typ`, audience, expiry). See [`docs/keycloak.md`](docs/keycloak.md).
- Secrets are supplied only through environment variables and are masked in logs; logs never contain tokens, `Authorization` headers, keys, webhook URLs or full query strings.
- The container runs as a non-root numeric user on a distroless base with a read-only root filesystem.
- Dependencies are pinned; CI runs `govulncheck` and `npm audit --audit-level=high`, and Dependabot proposes weekly updates.
