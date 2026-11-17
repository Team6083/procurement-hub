import { Skeleton, Table, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useMembers } from '../api/members';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { TableShell } from '../components/ui/table';
import { DefaultSubgroupSelect } from '../features/teams/DefaultSubgroupSelect';
import { RoleCell } from '../features/teams/RoleBadges';
import { useTeamCtx } from '../features/teams/TeamContext';

/** Read-only member list; members may change only their own default subgroup here. */
export function TeamMembersTab() {
  const { t } = useTranslation('teams');
  const { teamId, full, isMember } = useTeamCtx();
  const { me } = useMe();
  const members = useMembers(teamId, isMember);
  if (!full || !isMember) return <Notice>{t('settings.forbidden')}</Notice>;
  if (members.isPending) return <Skeleton h="24" rounded="l3" />;
  if (members.error) return <ErrorAlert error={members.error} />;
  return (
    <TableShell minW="520px">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t('members.user')}</Table.ColumnHeader>
          <Table.ColumnHeader>{t('members.effective')}</Table.ColumnHeader>
          <Table.ColumnHeader>{t('members.defaultSubgroup')}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {members.data.map((m) => (
          <Table.Row key={m.userId}>
            <Table.Cell>
              <Text textStyle="sm" fontWeight="medium">{m.displayName || m.username}</Text>
              <Text textStyle="xs" color="fg.muted">{m.email}</Text>
            </Table.Cell>
            <Table.Cell>
              <RoleCell sources={m} effective={m.effectiveRole} />
            </Table.Cell>
            <Table.Cell>
              <DefaultSubgroupSelect team={full} member={m} disabled={m.userId !== me?.id || full.archived} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </TableShell>
  );
}
