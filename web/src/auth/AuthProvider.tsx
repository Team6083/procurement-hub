import type { User, UserManager } from 'oidc-client-ts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { CALLBACK_PATH, safeReturnTo, type SigninState } from './oidc';

interface AuthContextValue {
  user: User;
  getAccessToken: () => string | undefined;
  /** Forces a refresh-token renewal; returns the new access token or undefined. */
  renew: () => Promise<string | undefined>;
  signinRedirect: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const c = useContext(AuthContext);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}

function currentRoute(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

export function AuthProvider({ manager, children }: { manager: UserManager; children: ReactNode }) {
  const { t } = useTranslation('auth');
  const [user, setUser] = useState<User | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const signinRedirect = useCallback(async () => {
    const state: SigninState = { returnTo: currentRoute() };
    await manager.signinRedirect({ state });
  }, [manager]);

  useEffect(() => {
    if (started.current) return; // avoid double callback processing in StrictMode
    started.current = true;
    void (async () => {
      try {
        if (window.location.pathname === CALLBACK_PATH) {
          const u = await manager.signinCallback();
          if (!u) throw new Error('No user returned from callback');
          const returnTo = safeReturnTo((u.state as Partial<SigninState> | undefined)?.returnTo);
          window.history.replaceState(null, '', returnTo); // restore route before the router mounts
          setUser(u);
          return;
        }
        const existing = await manager.getUser();
        if (existing && !existing.expired) setUser(existing);
        else await signinRedirect();
      } catch {
        setFailed(true);
      }
    })();
  }, [manager, signinRedirect]);

  useEffect(() => {
    const onLoaded = (u: User) => setUser(u);
    const onGone = () => void signinRedirect();
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onGone);
    manager.events.addSilentRenewError(() => undefined); // 401 path in the API client recovers
    return () => {
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onGone);
    };
  }, [manager, signinRedirect]);

  const value = useMemo<AuthContextValue | null>(
    () =>
      user
        ? {
            user,
            getAccessToken: () => user.access_token,
            renew: async () => (await manager.signinSilent())?.access_token,
            signinRedirect,
            logout: () => manager.signoutRedirect({ post_logout_redirect_uri: window.location.origin }),
          }
        : null,
    [user, manager, signinRedirect],
  );

  if (failed) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" maw={480}>
          <Title order={2}>{t('callbackFailed.title')}</Title>
          <Text>{t('callbackFailed.body')}</Text>
          <Button
            onClick={() => {
              window.location.replace('/');
            }}
          >
            {t('callbackFailed.retry')}
          </Button>
        </Stack>
      </Center>
    );
  }
  if (!value) {
    return (
      <Center mih="100vh">
        <Stack align="center">
          <Loader />
          <Text>{t('signingIn')}</Text>
        </Stack>
      </Center>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
