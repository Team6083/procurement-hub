import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * The app's query client. After every successful write, everything on screen is refetched
 * (and everything else marked stale), so a saved field or amount shows up without a reload.
 * Listing per mutation which queries it touches kept missing some (cross-batch pages, orders
 * after receiving, team lists after renames); the few extra GETs are cheap.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    mutationCache: new MutationCache({
      onSuccess: () => {
        void client.invalidateQueries();
      },
    }),
  });
  return client;
}
