import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { AppConfig } from '../config';

export interface SigninState {
  returnTo: string;
}

export const CALLBACK_PATH = '/auth/callback';

/** Public client, Authorization Code + PKCE (S256, the library default). Tokens live in memory only. */
export function createUserManager(config: AppConfig, origin = window.location.origin): UserManager {
  return new UserManager({
    authority: config.oidc.authority,
    client_id: config.oidc.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: origin,
    response_type: 'code',
    scope: config.oidc.scope,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    automaticSilentRenew: true, // uses the refresh token when present; no iframe is created
    // Newest refresh token is always stored by the library on each renewal.
  });
}

export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith(CALLBACK_PATH)
    ? value
    : '/';
}
