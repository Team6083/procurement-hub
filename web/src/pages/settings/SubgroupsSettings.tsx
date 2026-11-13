import { Badge, Button, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeamMutation } from '../../api/teams';
import type { Subgroup, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useTeamCtx } from '../../features/teams/TeamContext';

function AddSubgroup({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const [name, setName] = useState('');
  const add = useTeamMutation<string>(team.id, (api, headers, n) =>
    api.full.post<Team>(`/teams/${team.id}/subgroups`, { name: n }, { headers }),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) add.mutate(name.trim(), { onSuccess: () => setName('') });
      }}
    >
      <Stack gap="xs" maw={480}>
        <Group align="flex-end" wrap="nowrap">
          <TextInput style={{ flex: 1 }} label={t('subgroups.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} />
          <Button type="submit" loading={add.isPending} disabled={!name.trim() || team.archived}>{t('subgroups.add')}</Button>
        </Group>
        <ErrorAlert error={add.error} />
      </Stack>
    </form>
  );
}

function SubgroupRow({ team, group }: { team: Team; group: Subgroup }) {
  const { t } = useTranslation('teams');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const patch = useTeamMutation<{ name?: string; active?: boolean }>(team.id, (api, headers, body) =>
    api.full.patch<Team>(`/teams/${team.id}/subgroups/${group.id}`, body, { headers }),
  );
  const rename = () => {
    const n = name.trim();
    if (!n || n === group.name) return setEditing(false);
    patch.mutate({ name: n }, { onSuccess: () => setEditing(false) });
  };
  return (
    <Table.Tr>
      <Table.Td>
        {editing ? (
          <Stack gap={4}>
            <TextInput aria-label={t('subgroups.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} size="xs" />
            <ErrorAlert error={patch.error} />
          </Stack>
        ) : (
          <Group gap="xs">
            <Text size="sm" c={group.active ? undefined : 'dimmed'}>{group.name}</Text>
            {!group.active && <Badge color="gray">{t('subgroups.inactive')}</Badge>}
          </Group>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          {editing ? (
            <>
              <Button size="xs" loading={patch.isPending} onClick={rename}>{t('common:actions.save')}</Button>
              <Button size="xs" variant="default" onClick={() => { setEditing(false); setName(group.name); }}>{t('common:actions.cancel')}</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="default" disabled={team.archived} onClick={() => setEditing(true)}>{t('subgroups.rename')}</Button>
              <Button
                size="xs"
                variant="light"
                color={group.active ? 'red' : 'blue'}
                disabled={team.archived}
                loading={patch.isPending}
                onClick={() => patch.mutate({ active: !group.active })}
              >
                {group.active ? t('subgroups.deactivate') : t('subgroups.activate')}
              </Button>
            </>
          )}
        </Group>
        {!editing && <ErrorAlert error={patch.error} />}
      </Table.Td>
    </Table.Tr>
  );
}

export function SubgroupsSettings() {
  const { t } = useTranslation('teams');
  const { full } = useTeamCtx();
  if (!full) return null;
  return (
    <Stack>
      <Title order={3}>{t('settings.nav.subgroups')}</Title>
      <AddSubgroup key={`add-${full.version}`} team={full} />
      {full.subgroups.length === 0 ? (
        <Text c="dimmed">{t('subgroups.empty')}</Text>
      ) : (
        <Table maw={640}>
          <Table.Tbody>
            {full.subgroups.map((g) => (
              <SubgroupRow key={g.id} team={full} group={g} />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
