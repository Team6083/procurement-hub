import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../api/me';
import { useMembers, useRoleHolders } from '../../api/members';

/**
 * Resolves user ids to display names: the team's member list (only readable by members and system admins), then the
 * purchasers (global role holders, usually not team members), then the viewer themself. An id none of them knows
 * reads "Former member" when the team list is known, and "Team member" for a viewer who cannot read it: never the id
 * (the team's DESIGN.md: Data pages).
 */
export function useNames(teamId: string | undefined, enabled: boolean) {
  const { t } = useTranslation('batches');
  const { me } = useMe();
  const members = useMembers(teamId, enabled);
  const holders = useRoleHolders('purchaser');
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const u of holders.data ?? []) map.set(u.id, u.displayName || u.username);
    if (me) map.set(me.id, me.displayName || me.username);
    for (const m of members.data ?? []) map.set(m.userId, m.displayName || m.username);
    const fallback = !enabled || members.isError ? t('people.member') : members.data ? t('people.former') : '…';
    return {
      members: members.data ?? [],
      /** Whether names can be shown at all; false for viewers outside the team. */
      known: enabled,
      name: (id: string) => map.get(id) ?? fallback,
    };
  }, [members.data, members.isError, holders.data, me, enabled, t]);
}
