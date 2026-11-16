import { Badge, Button, Flex, HStack, Input, Stack, Table, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import { LuFolderTree } from 'react-icons/lu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeamMutation } from '../../api/teams';
import type { Subgroup, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { TableShell } from '../../components/ui/table';
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
      <Stack gap="2" maxW="480px">
        <Flex align="flex-end" gap="2">
          <FormField flex="1" label={t('subgroups.name')}>
            <Input value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} />
          </FormField>
          <Button size="sm" type="submit" loading={add.isPending} disabled={!name.trim() || team.archived}>{t('subgroups.add')}</Button>
        </Flex>
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
    <Table.Row>
      <Table.Cell>
        {editing ? (
          <Stack gap="1">
            <Input size="xs" aria-label={t('subgroups.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} />
            <ErrorAlert error={patch.error} />
          </Stack>
        ) : (
          <HStack gap="2">
            <Text fontSize="sm" color={group.active ? undefined : 'fg.muted'}>{group.name}</Text>
            {!group.active && <Badge colorPalette="gray">{t('subgroups.inactive')}</Badge>}
          </HStack>
        )}
      </Table.Cell>
      <Table.Cell>
        <HStack gap="2" justify="flex-end">
          {editing ? (
            <>
              <Button size="xs" loading={patch.isPending} onClick={rename}>{t('common:actions.save')}</Button>
              <Button size="xs" variant="outline" onClick={() => { setEditing(false); setName(group.name); }}>{t('common:actions.cancel')}</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="outline" disabled={team.archived} onClick={() => setEditing(true)}>{t('subgroups.rename')}</Button>
              <Button
                size="xs"
                variant="subtle"
                colorPalette={group.active ? 'red' : undefined}
                disabled={team.archived}
                loading={patch.isPending}
                onClick={() => patch.mutate({ active: !group.active })}
              >
                {group.active ? t('subgroups.deactivate') : t('subgroups.activate')}
              </Button>
            </>
          )}
        </HStack>
        {!editing && <ErrorAlert error={patch.error} />}
      </Table.Cell>
    </Table.Row>
  );
}

export function SubgroupsSettings() {
  const { t } = useTranslation('teams');
  const { full } = useTeamCtx();
  if (!full) return null;
  return (
    <Stack gap="4">
      <SectionHeader title={t('settings.nav.subgroups')} mb="0" />
      <AddSubgroup key={`add-${full.version}`} team={full} />
      {full.subgroups.length === 0 ? (
        <EmptyState icon={<LuFolderTree />} title={t('subgroups.empty')} />
      ) : (
        <TableShell maxW="640px">
          <Table.Body>
            {full.subgroups.map((g) => (
              <SubgroupRow key={g.id} team={full} group={g} />
            ))}
          </Table.Body>
        </TableShell>
      )}
    </Stack>
  );
}
