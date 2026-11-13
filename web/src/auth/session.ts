import type { User, UserManager } from 'oidc-client-ts';
import { currentRoute, type SigninState } from './oidc';

/**
 * A 401 that survives one renew + retry starts a new sign-in. If the API keeps rejecting fresh
 * tokens (e.g. a wrong audience), the IdP's SSO session would bounce the browser forever, so a
 * second API-triggered redirect within this window shows the "session rejected" page instead.
 */
export const REDIRECT_COOLDOWN_MS = 60_000;
export const REDIRECT_AT_KEY = 'ph.authRedirectAt';

type Manager = Pick<UserManager, 'getUser' | 'signinSilent' | 'signinRedirect'>;

export interface SessionDeps {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  location?: () => string;
}

/** Glue between the UserManager and code outside React (the API client). Spec section 7.1. */
export function createSession(manager: Manager, deps: SessionDeps = {}) {
  const now = deps.now ?? Date.now;
  const location = deps.location ?? (() => currentRoute());
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage;
  let renewing: Promise<string | undefined> | null = null;
  let rejected = false;
  const listeners = new Set<() => void>();

  function signinRedirect(returnTo = location()): Promise<void> {
    const state: SigninState = { returnTo };
    return manager.signinRedirect({ state });
  }

  return {
    async getToken(): Promise<string | undefined> {
      // An expired token is still sent: the 401 path renews and retries.
      return (await manager.getUser())?.access_token;
    },

    /** One refresh-token renewal shared by every concurrent caller; undefined on failure. */
    renew(): Promise<string | undefined> {
      renewing ??= (async () => {
        const user: User | null = await manager.getUser();
        if (!user?.refresh_token) return undefined; // never fall back to an iframe
        return (await manager.signinSilent())?.access_token ?? undefined;
      })()
        .catch(() => undefined)
        .finally(() => {
          renewing = null;
        });
      return renewing;
    },

    signinRedirect,

    /** The API rejected the best token we have: sign in again, unless that just happened. */
    async onAuthFailure(): Promise<void> {
      const t = now();
      try {
        const last = Number(storage?.getItem(REDIRECT_AT_KEY));
        if (last && t - last >= 0 && t - last < REDIRECT_COOLDOWN_MS) {
          rejected = true;
          listeners.forEach((l) => l());
          return;
        }
        storage?.setItem(REDIRECT_AT_KEY, String(t));
      } catch {
        /* no storage: no loop guard, still sign in */
      }
      await signinRedirect();
    },

    isRejected: () => rejected,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Session = ReturnType<typeof createSession>;

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
