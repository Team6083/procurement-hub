import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { ApiContext } from './api/context';
import { createApiClient } from './api/client';
import { useMeta } from './api/meta';
import { AuthProvider } from './auth/AuthProvider';
import { createUserManager } from './auth/oidc';
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
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
    [],
  );
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getToken: async () => (await manager.getUser())?.access_token,
        renew: async () => (await manager.signinSilent())?.access_token,
        onAuthFailure: () =>
          manager.signinRedirect({
            state: { returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` },
          }),
      }),
    [config, manager],
  );
  return (
    <MantineProvider defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <AuthProvider manager={manager}>
            <AuthedApp />
          </AuthProvider>
        </ApiContext.Provider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
