import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './context';
import type { Locale, Me, MyMembership } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, type Versioned } from './versioned';

export const meKey = ['me'] as const;

const NO_MEMBERSHIPS: MyMembership[] = [];

/** GET /me with its ETag. Exposes memberships and the system-admin flag. */
export function useMe() {
  const api = useApi();
  const q = useQuery({
    queryKey: meKey,
    queryFn: async ({ signal }): Promise<Versioned<Me>> => {
      const r = await api.full.get<Me>('/me', { signal });
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
  });
  return {
    ...q,
    me: q.data?.data,
    etag: q.data?.etag,
    memberships: q.data?.data.memberships ?? NO_MEMBERSHIPS,
    isSystemAdmin: q.data?.data.isSystemAdmin ?? false,
  };
}

/** PATCH /me (locale), sending If-Match with the cached ETag. */
export function usePatchMe() {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<{ locale: Locale }, Versioned<Me>>({
    mutationFn: async (body) => {
      const cached = qc.getQueryData<Versioned<Me>>(meKey);
      const r = await api.full.patch<Me>('/me', body, { headers: ifMatchHeader(cached?.etag) });
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
    conflictKeys: [meKey],
    onSuccess: (v) => qc.setQueryData(meKey, v),
  });
}
