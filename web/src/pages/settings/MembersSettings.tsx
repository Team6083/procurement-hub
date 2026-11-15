import { Button, Flex, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddMember, useMembers, usePatchMember, useRemoveMember } from '../../api/members';
import type { Role, Team, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { SelectField } from '../../components/ui/select';
import { TableShell } from '../../components/ui/table';
import { DefaultSubgroupSelect } from '../../features/teams/DefaultSubgroupSelect';
import { RoleCell } from '../../features/teams/RoleBadges';
import { useTeamCtx } from '../../features/teams/TeamContext';
import { canClearManualRole, canRemoveMember } from '../../features/teams/roles';

function AddMember({ team, existing }: { team: Team; existing: string[] }) {
  const { t } = useTranslation('teams');
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('member');
  const add = useAddMember(team.id);
  return (
    <Stack gap="2" maxW="560px">
      <Text fontWeight="semibold">{t('members.add')}</Text>
      <UserSearchSelect label={t('members.user')} value={userId} onChange={setUserId} excludeIds={existing} />
      <Flex align="flex-end" gap="3" wrap="wrap">
        <SelectField
          label={t('members.role')}
          w="160px"
          value={role}
          onChange={(v) => v && setRole(v as Role)}
          options={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))}
        />
        <Button
          size="sm"
          disabled={!userId || team.archived}
          loading={add.isPending}
          onClick={() => userId && add.mutate({ userId, role }, { onSuccess: () => setUserId(null) })}
        >
          {t('members.addButton')}
        </Button>
      </Flex>
      <ErrorAlert error={add.error} />
    </Stack>
  );
}

function MemberRow({ team, member, onRemove }: { team: Team; member: TeamMember; onRemove: (m: TeamMember) => void }) {
  const { t } = useTranslation('teams');
  const patch = usePatchMember(team.id);
  return (
    <Table.Row>
      <Table.Cell>
        <Text fontSize="sm" fontWeight="medium">{member.displayName || member.username}</Text>
        <Text fontSize="xs" color="fg.muted">{member.email}</Text>
      </Table.Cell>
      <Table.Cell>
        <RoleCell sources={member} effective={member.effectiveRole} />
      </Table.Cell>
      <Table.Cell>
        <SelectField
          aria-label={t('members.manualRole')}
          size="xs"
          w="130px"
          placeholder={member.manualRole ? undefined : t('members.noManual')}
          disabled={team.archived || patch.isPending}
          value={member.manualRole || ''}
          options={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))}
          onChange={(v) => v && v !== member.manualRole && patch.mutate({ member, patch: { manualRole: v as Role } })}
        />
      </Table.Cell>
      <Table.Cell>
        <DefaultSubgroupSelect team={team} member={member} disabled={team.archived} />
      </Table.Cell>
      <Table.Cell>
        <HStack gap="2">
          {canClearManualRole(member) && (
            <Button size="xs" variant="outline" disabled={team.archived} loading={patch.isPending} onClick={() => patch.mutate({ member, patch: { manualRole: null } })}>
              {t('members.clearManual')}
            </Button>
          )}
          {canRemoveMember(member) && (
            <Button size="xs" colorPalette="red" variant="subtle" disabled={team.archived} onClick={() => onRemove(member)}>
              {t('members.remove')}
            </Button>
          )}
        </HStack>
        <ErrorAlert error={patch.error} />
      </Table.Cell>
    </Table.Row>
  );
}

export function MembersSettings() {
  const { t } = useTranslation('teams');
  const { teamId, full } = useTeamCtx();
  const members = useMembers(teamId);
  const remove = useRemoveMember(teamId);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);
  if (!full) return null;
  return (
    <Stack gap="4">
      <SectionHeader title={t('settings.nav.members')} mb="0" />
      <AddMember team={full} existing={(members.data ?? []).map((m) => m.userId)} />
      {members.isPending && <Skeleton h="24" rounded="l3" />}
      {members.error && <ErrorAlert error={members.error} />}
      {members.data && (
        <TableShell minW="760px">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t('members.user')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('members.effective')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('members.manualRole')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('members.defaultSubgroup')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('members.actions')}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {members.data.map((m) => (
              <MemberRow key={m.userId} team={full} member={m} onRemove={(x) => { remove.reset(); setToRemove(x); }} />
            ))}
          </Table.Body>
        </TableShell>
      )}
      <ReasonModal
        opened={!!toRemove}
        title={t('members.removeTitle')}
        body={
          <>
            {t('members.removeConfirm', { name: toRemove?.displayName || toRemove?.username })}
            <Text as="span" display="block" mt="2" color="fg.muted">{t('members.removeNote')}</Text>
          </>
        }
        confirmLabel={t('members.remove')}
        danger
        loading={remove.isPending}
        error={remove.error}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && remove.mutate(toRemove, { onSuccess: () => setToRemove(null) })}
      />
    </Stack>
  );
}
