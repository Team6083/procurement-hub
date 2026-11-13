import { useTranslation } from 'react-i18next';
import { usePatchMember } from '../../api/members';
import type { Team, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { SelectField } from '../../components/ui/select';

/** Default-subgroup picker. Only rendered enabled for team admins or the member themself. */
export function DefaultSubgroupSelect({ team, member, disabled }: { team: Team; member: TeamMember; disabled?: boolean }) {
  const { t } = useTranslation('teams');
  const patch = usePatchMember(team.id);
  const options = team.subgroups.filter((g) => g.active || g.id === member.defaultSubgroupId).map((g) => ({ value: g.id, label: g.name }));
  return (
    <>
      <SelectField
        aria-label={t('members.defaultSubgroup')}
        placeholder={t('members.noDefault')}
        size="xs"
        w="160px"
        disabled={disabled || patch.isPending}
        options={options}
        value={member.defaultSubgroupId || ''}
        onChange={(v) => patch.mutate({ member, patch: { defaultSubgroupId: v } })}
      />
      {patch.error && <ErrorAlert error={patch.error} />}
    </>
  );
}
