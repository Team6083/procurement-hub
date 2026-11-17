import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { useApi } from './context';
import { keys } from './keys';
import type { Page, Team, TeamSummary } from './types';
import { ifMatchHeader, useVersionedMutation } from './versioned';

export function useTeams() {
  const api = useApi();
  return useQuery({
    queryKey: keys.teams,
    queryFn: async ({ signal }) => (await api.get<Page<TeamSummary>>('/teams', { signal })).items,
  });
}

/** GET /teams/{id}: the full Team (with `version`) for members and system admins, a summary for everyone else. */
export function useTeam(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: keys.team(id),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<Team | TeamSummary>(`/teams/${id}`, { signal }),
  });
}

/** A write on a team, with the cached team's version in If-Match. */
export function useTeamMutation<TVars>(teamId: string, call: (api: ApiClient, vars: TVars, headers: Record<string, string>) => Promise<Team>) {
  return useVersionedMutation<TVars, Team>(keys.team(teamId), (api, vars, version) => call(api, vars, ifMatchHeader(version)));
}
