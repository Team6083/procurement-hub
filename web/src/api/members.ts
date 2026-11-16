import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { meKey } from './me';
import { teamKey } from './teams';
import type { Page, PatchMemberRequest, Role, TeamMember, User } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export const membersKey = (teamId: string | undefined) => ['team', teamId, 'members'] as const;

export function useMembers(teamId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: membersKey(teamId),
    enabled: !!teamId && enabled,
    queryFn: async ({ signal }) => (await api.get<Page<TeamMember>>(`/teams/${teamId}/members`, { signal })).items,
  });
}

// Member PATCH/DELETE require If-Match with the membership version from the members list.
export function useAddMember(teamId: string) {
  const api = useApi();
  return useGuardedMutation<{ userId: string; role: Role }, TeamMember>({
    mutationFn: (body) => api.post<TeamMember>(`/teams/${teamId}/members`, body),
    invalidate: [membersKey(teamId), meKey],
  });
}

export function usePatchMember(teamId: string) {
  const api = useApi();
  return useGuardedMutation<{ member: TeamMember; patch: PatchMemberRequest }, TeamMember>({
    mutationFn: ({ member, patch }) =>
      api.patch<TeamMember>(`/teams/${teamId}/members/${member.userId}`, patch, { headers: ifMatchHeader(member.version) }),
    invalidate: [membersKey(teamId), meKey],
  });
}

export function useRemoveMember(teamId: string) {
  const api = useApi();
  return useGuardedMutation<TeamMember, void>({
    mutationFn: (member) =>
      api.delete<void>(`/teams/${teamId}/members/${member.userId}`, { headers: ifMatchHeader(member.version) }),
    invalidate: [membersKey(teamId), meKey, teamKey(teamId)],
  });
}

export function useUserSearch(q: string) {
  const api = useApi();
  const term = q.trim();
  return useQuery({
    queryKey: ['users', term],
    enabled: term.length >= 2,
    queryFn: async ({ signal }) => (await api.get<Page<User>>('/users', { query: { q: term }, signal })).items,
  });
}

/** Users whose role snapshot has the role: candidates for batch purchaser assignment (never used for authorization). */
export function useRoleHolders(role: 'purchaser' | 'receiver') {
  const api = useApi();
  return useQuery({
    queryKey: ['users', 'role', role],
    queryFn: async ({ signal }) => (await api.get<Page<User>>('/users', { query: { role }, signal })).items,
  });
}
