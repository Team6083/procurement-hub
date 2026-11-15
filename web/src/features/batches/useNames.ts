import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMembers } from '../../api/members';

/**
 * Resolves user ids to display names via the team's member list (only readable by members and system admins).
 * The list holds current members only, so an id it lacks (someone who has left the team) reads "Former member",
 * and a viewer who cannot read the list sees "Team member": never the id (the team's DESIGN.md: Data pages).
 */
export function useNames(teamId: string | undefined, enabled: boolean) {
  const { t } = useTranslation('batches');
  const members = useMembers(teamId, enabled);
  return useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.userId, m.displayName || m.username]));
    const fallback = !enabled || members.isError ? t('people.member') : members.data ? t('people.former') : '…';
    return {
      members: members.data ?? [],
      /** Whether names can be shown at all; false for viewers outside the team. */
      known: enabled,
      name: (id: string) => map.get(id) ?? fallback,
    };
  }, [members.data, members.isError, enabled, t]);
}
