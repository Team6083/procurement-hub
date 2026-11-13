import { createContext, useContext } from 'react';
import type { Team, TeamSummary } from '../../api/types';

export interface TeamCtx {
  teamId: string;
  slug: string;
  team: Team | TeamSummary;
  /** Full team (members and system admins only). */
  full: Team | undefined;
  canAdmin: boolean;
  isMember: boolean;
}

export const TeamContext = createContext<TeamCtx | null>(null);

export function useTeamCtx(): TeamCtx {
  const c = useContext(TeamContext);
  if (!c) throw new Error('TeamContext missing');
  return c;
}
