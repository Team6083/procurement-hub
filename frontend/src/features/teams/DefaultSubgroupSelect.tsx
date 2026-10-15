import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { usePatchMember } from '../../api/members';
import type { Team, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';

/** Default-subgroup picker. Only rendered enabled for team admins or the member themself. */
export function DefaultSubgroupSelect({ team, member, disabled }: { team: Team; member: TeamMember; disabled?: boolean }) {
  const { t } = useTranslation('teams');
  const patch = usePatchMember(team.id);
  const data = team.subgroups.filter((g) => g.active || g.id === member.defaultSubgroupId).map((g) => ({ value: g.id, label: g.name }));
  return (
    <>
      <Select
        aria-label={t('members.defaultSubgroup')}
        placeholder={t('members.noDefault')}
        size="xs"
        clearable
        disabled={disabled || patch.isPending}
        data={data}
        value={member.defaultSubgroupId || null}
        onChange={(v) => patch.mutate({ member, patch: { defaultSubgroupId: v ?? '' } })}
      />
      {patch.error && <ErrorAlert error={patch.error} />}
    </>
  );
}
