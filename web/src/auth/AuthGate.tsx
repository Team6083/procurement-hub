import { Button, Center, Code, Spinner, Stack, Text } from '@chakra-ui/react';
import { StatusPage } from '@team6083/ui';
import type { User, UserManager } from 'oidc-client-ts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { withBase } from '../config';
import { isCallbackPath, returnToFromState } from './oidc';
import type { Session } from './session';

/** Puts the browser back on the route sign-in started from, before the router mounts. */
function restoreRoute(user: User | undefined): void {
  window.history.replaceState(null, '', returnToFromState(user?.state));
}

/**
 * react-oidc-context provider plus a gate that renders children only with a signed-in user
 * (spec section 7.1). Router-agnostic: the return route travels in the OIDC state and is
 * restored with history.replaceState, so whichever router mounts afterwards reads it.
 */
export function AppAuthProvider({ manager, session, children }: { manager: UserManager; session: Session; children: ReactNode }) {
  return (
    <AuthProvider userManager={manager} skipSigninCallback={!isCallbackPath()} onSigninCallback={restoreRoute}>
      <AuthGate session={session}>{children}</AuthGate>
    </AuthProvider>
  );
}

function AuthGate({ session, children }: { session: Session; children: ReactNode }) {
  const { t } = useTranslation('auth');
  const auth = useAuth();
  const rejected = useSyncExternalStore(session.subscribe, session.isRejected);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const redirecting = useRef(false);

  // Once per page: StrictMode re-runs effects, and the renew-error event may fire as well.
  const startSignin = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    session.signinRedirect().catch((e: unknown) => {
      redirecting.current = false;
      setRedirectError(e instanceof Error ? e.message : String(e));
    });
  }, [session]);

  // A failed background renew means the refresh token is gone: sign in again.
  useEffect(() => auth.events.addSilentRenewError(() => startSignin()), [auth.events, startSignin]);

  const needsSignin = !auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error;
  useEffect(() => {
    if (needsSignin) startSignin();
  }, [needsSignin, startSignin]);

  const callbackError = auth.error?.source === 'signinCallback' ? auth.error.message : null;
  const failure = callbackError ?? redirectError;
  if (failure !== null) {
    return (
      <StatusPage
        minH="100vh"
        title={t('callbackFailed.title')}
        description={t('callbackFailed.body')}
        actions={<Button onClick={() => window.location.replace(withBase('/'))}>{t('callbackFailed.retry')}</Button>}
      >
        <Code display="block" whiteSpace="pre-wrap" wordBreak="break-word" textAlign="start" p="3" w="full">
          {failure}
        </Code>
      </StatusPage>
    );
  }
  if (rejected) {
    return (
      <StatusPage
        minH="100vh"
        title={t('sessionRejected.title')}
        description={t('sessionRejected.body')}
        // User-initiated, so it bypasses the redirect cooldown.
        actions={<Button onClick={() => void session.signinRedirect()}>{t('sessionRejected.signIn')}</Button>}
      />
    );
  }
  if (!auth.isAuthenticated) {
    return (
      <Center minH="100vh">
        <Stack align="center">
          <Spinner />
          <Text>{t('signingIn')}</Text>
        </Stack>
      </Center>
    );
  }
  return <>{children}</>;
}

/** The signed-in user and sign-out, for components rendered inside the gate. */
export function useSession() {
  const auth = useAuth();
  if (!auth.user) throw new Error('useSession used outside the signed-in gate');
  return {
    user: auth.user,
    // post_logout_redirect_uri comes from the UserManager settings (the app root).
    logout: () => auth.signoutRedirect(),
  };
}
