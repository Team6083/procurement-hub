import { InMemoryWebStorage, UserManager, WebStorageStateStore, type SigninSilentArgs, type User } from 'oidc-client-ts';
import { BASE_PATH, withBase, type AppConfig } from '../config';

/** Carried through the OIDC `state` so the callback can return to where sign-in started. */
export interface SigninState {
  returnTo: string;
}

/** Router path of the OIDC callback (spec section 7.1), relative to the base path. */
export const CALLBACK_PATH = '/auth/callback';

/**
 * Public client, Authorization Code flow with PKCE (oidc-client-ts always uses S256 for the
 * code flow). Spec section 7.1:
 * - tokens live in memory only (userStore = InMemoryWebStorage); a full reload signs in again
 *   through the IdP's SSO session. The state store keeps the library default (sessionStorage):
 *   it only holds the PKCE verifier and SigninState across the redirect, never tokens.
 * - automaticSilentRenew renews with the refresh token only (RefreshOnlyUserManager); a failed
 *   renew surfaces as silentRenewError and the app falls back to signinRedirect.
 */
export function createUserManager(config: AppConfig, origin = window.location.origin, base = BASE_PATH): UserManager {
  return new RefreshOnlyUserManager({
    authority: config.oidc.authority,
    client_id: config.oidc.clientId,
    redirect_uri: `${origin}${withBase(CALLBACK_PATH, base)}`,
    post_logout_redirect_uri: `${origin}${withBase('/', base)}`,
    response_type: 'code',
    scope: config.oidc.scope,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    automaticSilentRenew: true,
  });
}

/**
 * oidc-client-ts falls back to a hidden iframe (prompt=none) when the user has no refresh token.
 * Spec section 7.1 renews with the refresh token only, so that fallback is refused here.
 */
export class RefreshOnlyUserManager extends UserManager {
  override async signinSilent(args?: SigninSilentArgs): Promise<User | null> {
    const user = await this.getUser();
    if (!user?.refresh_token) throw new Error('No refresh token: iframe-based silent renew is disabled');
    return super.signinSilent(args);
  }
}

/** The current browser location (path, query, hash), used as the post-login return target. */
export function currentRoute(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location): string {
  return `${loc.pathname}${loc.search}${loc.hash}`;
}

export function isCallbackPath(pathname = window.location.pathname, base = BASE_PATH): boolean {
  return pathname === withBase(CALLBACK_PATH, base);
}

/**
 * Validates a return target from the OIDC state: same-origin, inside the base path, and not the
 * callback itself (which would loop). Anything else becomes the app root.
 */
export function safeReturnTo(value: unknown, base = BASE_PATH): string {
  const root = withBase('/', base);
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return root;
  if (!value.startsWith(root) && value !== root.replace(/\/$/, '')) return root;
  const path = value.split(/[?#]/, 1)[0];
  if (path === withBase(CALLBACK_PATH, base)) return root;
  return value;
}

/** Reads SigninState.returnTo from whatever the callback user carried. */
export function returnToFromState(state: unknown, base = BASE_PATH): string {
  const returnTo = state && typeof state === 'object' ? (state as Partial<SigninState>).returnTo : undefined;
  return safeReturnTo(returnTo, base);
}
