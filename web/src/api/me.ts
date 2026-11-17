import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { keys } from './keys';
import type { Locale, Me, MyMembership } from './types';
import { ifMatchHeader, useVersionedMutation } from './versioned';

const NO_MEMBERSHIPS: MyMembership[] = [];

/** GET /me. Exposes memberships and the system-admin flag. */
export function useMe() {
  const api = useApi();
  const q = useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api.get<Me>('/me', { signal }) });
  return {
    ...q,
    me: q.data,
    memberships: q.data?.memberships ?? NO_MEMBERSHIPS,
    isSystemAdmin: q.data?.isSystemAdmin ?? false,
  };
}

/** PATCH /me (locale). */
export function usePatchMe() {
  return useVersionedMutation<{ locale: Locale }, Me>(keys.me, (api, body, version) => api.patch<Me>('/me', body, { headers: ifMatchHeader(version) }));
}
