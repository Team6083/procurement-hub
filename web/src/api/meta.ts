import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import type { components } from './schema';

export type Meta = components['schemas']['Meta'];

/** GET /api/v1/meta (unauthenticated), fetched once on startup. */
export function useMeta() {
  const api = useApi();
  return useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => api.get<Meta>('/meta', { auth: false, signal }),
    staleTime: Infinity,
  });
}

/** The base currency, or '' until /meta has loaded (amounts show unformatted meanwhile; never a guessed currency). */
export function useBaseCurrency(): string {
  return useMeta().data?.baseCurrency ?? '';
}
