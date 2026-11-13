import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { useApi } from './context';
import { meKey } from './me';
import type { Page, Team, TeamSummary } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, type Versioned } from './versioned';

export const teamsKey = ['teams'] as const;
export const teamKey = (id: string | undefined) => ['team', id] as const;

export function useTeams() {
  const api = useApi();
  return useQuery({
    queryKey: teamsKey,
    queryFn: async ({ signal }) => (await api.get<Page<TeamSummary>>('/teams', { signal })).items,
  });
}

export type TeamData = Versioned<Team | TeamSummary>;

/** GET /teams/{id}. `etag` comes from the response header (absent for summaries). */
export function useTeam(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: teamKey(id),
    enabled: !!id,
    queryFn: async ({ signal }): Promise<TeamData> => {
      const r = await api.full.get<Team | TeamSummary>(`/teams/${id}`, { signal });
      return { data: r.data, etag: r.etag };
    },
  });
}

/**
 * Mutation against a team resource: sends If-Match from the cached ETag, replaces the
 * cache with the response (new ETag), and refetches on version_conflict.
 */
export function useTeamMutation<TVars>(
  teamId: string,
  call: (api: ApiClient, headers: Record<string, string>, vars: TVars) => Promise<{ data: Team; etag: number | undefined }>,
) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, Versioned<Team>>({
    mutationFn: async (vars) => {
      const cached = qc.getQueryData<TeamData>(teamKey(teamId));
      const r = await call(api, ifMatchHeader(cached?.etag), vars);
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
    invalidate: [teamsKey, meKey],
    conflictKeys: [teamKey(teamId)],
    onSuccess: (v) => qc.setQueryData(teamKey(teamId), v),
  });
}
