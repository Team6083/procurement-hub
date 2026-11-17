import { Badge, Button, Card, Flex, HStack, Input, Stack, Table, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import { LuFolderTree } from 'react-icons/lu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeamMutation } from '../../api/teams';
import type { Subgroup, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { FormField } from '../../components/ui/field';
import { TableShell } from '../../components/ui/table';
import { useTeamCtx } from '../../features/teams/TeamContext';

function AddSubgroup({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const add = useTeamMutation<string>(team.id, (api, n, headers) =>
    api.post<Team>(`/teams/${team.id}/subgroups`, { name: n }, { headers }),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (name.trim()) add.mutate(name.trim(), { onSuccess: () => { setName(''); setTried(false); } });
      }}
    >
      <Stack gap="2" maxW="480px">
        <Flex align="flex-end" gap="2">
          <FormField flex="1" label={t('subgroups.name')} required errorText={tried && !name.trim() ? t('common:validation.required') : undefined}>
            <Input value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} />
          </FormField>
          <Button size="sm" type="submit" loading={add.isPending} disabled={team.archived}>{t('subgroups.add')}</Button>
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
  const [confirming, setConfirming] = useState(false);
  const patch = useTeamMutation<{ name?: string; active?: boolean }>(team.id, (api, body, headers) => api.patch<Team>(`/teams/${team.id}/subgroups/${group.id}`, body, { headers }),
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
            <Text textStyle="sm" color={group.active ? undefined : 'fg.muted'}>{group.name}</Text>
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
                onClick={() => (group.active ? setConfirming(true) : patch.mutate({ active: true }))}
              >
                {group.active ? t('subgroups.deactivate') : t('subgroups.activate')}
              </Button>
            </>
          )}
        </HStack>
        {!editing && !confirming && <ErrorAlert error={patch.error} />}
        <ReasonModal
          opened={confirming} danger title={t('subgroups.deactivateTitle', { name: group.name })} body={t('subgroups.deactivateBody')}
          confirmLabel={t('subgroups.deactivate')} loading={patch.isPending} error={patch.error} onClose={() => setConfirming(false)}
          onConfirm={() => patch.mutate({ active: false }, { onSuccess: () => setConfirming(false) })}
        />
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
        <Card.Root size="sm"><Card.Body><EmptyState icon={<LuFolderTree />} title={t('subgroups.empty')} /></Card.Body></Card.Root>
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
