import { Button, Group, Loader, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import type { BatchStatus } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { paths } from '../paths';
import { CreateBatchModal } from '../features/batches/CreateBatchModal';
import { BatchStatusBadge } from '../features/batches/StatusBadges';

export const BATCH_STATUSES: BatchStatus[] = ['proposed', 'proposal_rejected', 'draft', 'collecting', 'reviewing', 'ordering', 'receiving', 'completed', 'cancelled'];

export function BatchesPage() {
  const { t } = useTranslation('batches');
  const { memberships } = useMe();
  const teams = useTeams();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [q] = useDebouncedValue(text, 300);
  const [opened, { open, close }] = useDisclosure(false);
  const list = useBatchList({ teamId: teamId ?? undefined, status: status ?? undefined, q });
  const batches = list.data?.pages.flatMap((p) => p.items) ?? [];
  const teamName = (id: string) => teams.data?.find((x) => x.id === id)?.name ?? '';
  const mine = memberships.filter((m) => !teams.data?.find((x) => x.id === m.teamId)?.archived);
  const canCreate = mine.length > 0;
  const anyAdmin = mine.some((m) => m.role === 'admin');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('list.title')}</Title>
        {canCreate && <Button onClick={open}>{anyAdmin ? t('list.new') : t('list.propose')}</Button>}
      </Group>
      <Group align="flex-end">
        <Select label={t('filters.team')} clearable placeholder={t('filters.all')} value={teamId} onChange={setTeamId} data={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <Select label={t('filters.status')} clearable placeholder={t('filters.all')} value={status} onChange={setStatus} data={BATCH_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        <TextInput label={t('filters.text')} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      </Group>
      {list.isPending && <Loader />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && batches.length === 0 && <Text c="dimmed">{t('list.empty')}</Text>}
      {batches.length > 0 && (
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('list.number')}</Table.Th>
                <Table.Th>{t('list.batchTitle')}</Table.Th>
                <Table.Th>{t('filters.team')}</Table.Th>
                <Table.Th>{t('filters.status')}</Table.Th>
                <Table.Th>{t('header.deadline')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {batches.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>#{b.number}</Table.Td>
                  <Table.Td><RouteAnchor to={paths.batch(b.id)}>{b.title}</RouteAnchor></Table.Td>
                  <Table.Td>{teamName(b.teamId)}</Table.Td>
                  <Table.Td><BatchStatusBadge status={b.status} /></Table.Td>
                  <Table.Td>{b.deadline ? new Date(b.deadline).toLocaleString() : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {list.hasNextPage && (
        <Group>
          <Button variant="default" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button>
        </Group>
      )}
      <CreateBatchModal opened={opened} onClose={close} teams={mine} defaultTeamId={teamId && mine.some((m) => m.teamId === teamId) ? teamId : undefined} />
    </Stack>
  );
}
