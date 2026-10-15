import { useMemo } from 'react';
import { useMembers } from '../../api/members';

/** Resolves user ids to display names via the team's member list (only readable by members/system admins). */
export function useNames(teamId: string | undefined, enabled: boolean) {
  const members = useMembers(teamId, enabled);
  return useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.userId, m.displayName || m.username]));
    return {
      members: members.data ?? [],
      name: (id: string) => map.get(id) ?? id.slice(-6),
    };
  }, [members.data]);
}
