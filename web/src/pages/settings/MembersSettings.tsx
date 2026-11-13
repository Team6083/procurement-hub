import { Button, Group, Loader, Modal, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddMember, useMembers, usePatchMember, useRemoveMember } from '../../api/members';
import type { Role, Team, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { UserSearchSelect } from '../../components/UserSearchSelect';
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
    <Stack gap="xs" maw={560}>
      <Text fw={600}>{t('members.add')}</Text>
      <UserSearchSelect label={t('members.user')} value={userId} onChange={setUserId} excludeIds={existing} />
      <Group align="flex-end">
        <Select
          label={t('members.role')}
          w={160}
          allowDeselect={false}
          value={role}
          onChange={(v) => v && setRole(v as Role)}
          data={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))}
        />
        <Button
          disabled={!userId || team.archived}
          loading={add.isPending}
          onClick={() => userId && add.mutate({ userId, role }, { onSuccess: () => setUserId(null) })}
        >
          {t('members.addButton')}
        </Button>
      </Group>
      <ErrorAlert error={add.error} />
    </Stack>
  );
}

function MemberRow({ team, member, onRemove }: { team: Team; member: TeamMember; onRemove: (m: TeamMember) => void }) {
  const { t } = useTranslation('teams');
  const patch = usePatchMember(team.id);
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm" fw={500}>{member.displayName || member.username}</Text>
        <Text size="xs" c="dimmed">{member.email}</Text>
      </Table.Td>
      <Table.Td>
        <RoleCell sources={member} effective={member.effectiveRole} />
      </Table.Td>
      <Table.Td>
        <Select
          aria-label={t('members.manualRole')}
          size="xs"
          w={130}
          placeholder={t('members.noManual')}
          allowDeselect={false}
          disabled={team.archived || patch.isPending}
          value={member.manualRole || null}
          data={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))}
          onChange={(v) => v && v !== member.manualRole && patch.mutate({ member, patch: { manualRole: v as Role } })}
        />
      </Table.Td>
      <Table.Td>
        <DefaultSubgroupSelect team={team} member={member} disabled={team.archived} />
      </Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {canClearManualRole(member) && (
            <Button size="xs" variant="default" disabled={team.archived} loading={patch.isPending} onClick={() => patch.mutate({ member, patch: { manualRole: null } })}>
              {t('members.clearManual')}
            </Button>
          )}
          {canRemoveMember(member) && (
            <Button size="xs" color="red" variant="light" disabled={team.archived} onClick={() => onRemove(member)}>
              {t('members.remove')}
            </Button>
          )}
        </Group>
        <ErrorAlert error={patch.error} />
      </Table.Td>
    </Table.Tr>
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
    <Stack>
      <Title order={3}>{t('settings.nav.members')}</Title>
      <AddMember team={full} existing={(members.data ?? []).map((m) => m.userId)} />
      {members.isPending && <Loader />}
      {members.error && <ErrorAlert error={members.error} />}
      {members.data && (
        <Table.ScrollContainer minWidth={760}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('members.user')}</Table.Th>
                <Table.Th>{t('members.effective')}</Table.Th>
                <Table.Th>{t('members.manualRole')}</Table.Th>
                <Table.Th>{t('members.defaultSubgroup')}</Table.Th>
                <Table.Th>{t('members.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.data.map((m) => (
                <MemberRow key={m.userId} team={full} member={m} onRemove={(x) => { remove.reset(); setToRemove(x); }} />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Modal opened={!!toRemove} onClose={() => setToRemove(null)} title={t('members.removeTitle')}>
        <Stack>
          <Text>{t('members.removeConfirm', { name: toRemove?.displayName || toRemove?.username })}</Text>
          <Text size="sm" c="dimmed">{t('members.removeNote')}</Text>
          <ErrorAlert error={remove.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setToRemove(null)}>{t('common:actions.cancel')}</Button>
            <Button color="red" loading={remove.isPending} onClick={() => toRemove && remove.mutate(toRemove, { onSuccess: () => setToRemove(null) })}>
              {t('members.remove')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
