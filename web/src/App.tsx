import { QueryClientProvider } from '@tanstack/react-query';
import { useCommitCheckedFetch } from '@team6083/ui';
import { createQueryClient } from './api/queryClient';
import { useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import { RouterProvider } from 'react-router';
import { ApiContext } from './api/context';
import { createApiClient } from './api/client';
import { useMeta } from './api/meta';
import { AccessGate } from './auth/AccessGate';
import { createAccessStore, type AccessStore } from './auth/access';
import { AppAuthProvider } from './auth/AuthGate';
import { createUserManager } from './auth/oidc';
import { createSession } from './auth/session';
import { useRuntimeConfig } from './config';
import { createAppRouter } from './router';

// Triggers the one-time unauthenticated GET /meta on startup.
function MetaPrefetch() {
  useMeta();
  return null;
}

function AuthedApp() {
  const router = useMemo(() => createAppRouter(), []); // created after callback restored the route
  return (
    <>
      <MetaPrefetch />
      <RouterProvider router={router} />
    </>
  );
}

/** Signed in but without an allowed role: only the no-access page (spec section 7.1). */
function GatedApp({ access }: { access: AccessStore }) {
  const auth = useAuth();
  return (
    <AccessGate store={access} onSignOut={() => void auth.signoutRedirect()}>
      <AuthedApp />
    </AccessGate>
  );
}

/** The API client; once the server runs another build its writes are refused (app_outdated) and reads still go through. */
export function App() {
  const config = useRuntimeConfig();
  const fetchImpl = useCommitCheckedFetch();
  const manager = useMemo(() => createUserManager(config), [config]);
  const session = useMemo(() => createSession(manager), [manager]);
  const access = useMemo(() => createAccessStore(), []);
  const queryClient = useMemo(
    () => createQueryClient(),
    [],
  );
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getToken: session.getToken,
        renew: session.renew,
        onAuthFailure: session.onAuthFailure,
        onMissingRole: access.deny,
        fetchImpl,
      }),
    [config, session, access, fetchImpl],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <AppAuthProvider manager={manager} session={session}>
          <GatedApp access={access} />
        </AppAuthProvider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}
