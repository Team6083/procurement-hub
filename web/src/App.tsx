import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { ApiContext } from './api/context';
import { createApiClient } from './api/client';
import { useMeta } from './api/meta';
import { AppAuthProvider } from './auth/AuthGate';
import { createUserManager } from './auth/oidc';
import { createSession } from './auth/session';
import type { AppConfig } from './config';
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

export function App({ config }: { config: AppConfig }) {
  const manager = useMemo(() => createUserManager(config), [config]);
  const session = useMemo(() => createSession(manager), [manager]);
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
    [],
  );
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getToken: session.getToken,
        renew: session.renew,
        onAuthFailure: session.onAuthFailure,
      }),
    [config, session],
  );
  return (
    <MantineProvider defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <AppAuthProvider manager={manager} session={session}>
            <AuthedApp />
          </AppAuthProvider>
        </ApiContext.Provider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
