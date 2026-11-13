import { Alert, Loader, Stack, Table, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useMembers } from '../api/members';
import { ErrorAlert } from '../components/ErrorAlert';
import { DefaultSubgroupSelect } from '../features/teams/DefaultSubgroupSelect';
import { RoleCell } from '../features/teams/RoleBadges';
import { useTeamCtx } from '../features/teams/TeamContext';

/** Read-only member list; members may change only their own default subgroup here. */
export function TeamMembersTab() {
  const { t } = useTranslation('teams');
  const { teamId, full, isMember } = useTeamCtx();
  const { me } = useMe();
  const members = useMembers(teamId, isMember);
  if (!full || !isMember) return <Alert color="gray">{t('settings.forbidden')}</Alert>;
  if (members.isPending) return <Loader />;
  if (members.error) return <ErrorAlert error={members.error} />;
  return (
    <Stack>
      <Table.ScrollContainer minWidth={520}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('members.user')}</Table.Th>
              <Table.Th>{t('members.effective')}</Table.Th>
              <Table.Th>{t('members.defaultSubgroup')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.data.map((m) => (
              <Table.Tr key={m.userId}>
                <Table.Td>
                  <Text size="sm" fw={500}>{m.displayName || m.username}</Text>
                  <Text size="xs" c="dimmed">{m.email}</Text>
                </Table.Td>
                <Table.Td>
                  <RoleCell sources={m} effective={m.effectiveRole} />
                </Table.Td>
                <Table.Td>
                  <DefaultSubgroupSelect team={full} member={m} disabled={m.userId !== me?.id || full.archived} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
