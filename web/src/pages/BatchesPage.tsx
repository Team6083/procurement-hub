import { Button, Flex, Heading, HStack, Input, Spinner, Stack, Table, Text, useDisclosure } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import type { BatchStatus } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { FormField } from '../components/ui/field';
import { SelectField } from '../components/ui/select';
import { TableShell } from '../components/ui/table';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { paths } from '../paths';
import { CreateBatchModal } from '../features/batches/CreateBatchModal';
import { BatchStatusBadge } from '../features/batches/StatusBadges';

export const BATCH_STATUSES: BatchStatus[] = ['proposed', 'proposal_rejected', 'draft', 'collecting', 'reviewing', 'ordering', 'receiving', 'completed', 'cancelled'];

export function BatchesPage() {
  const { t } = useTranslation('batches');
  const { memberships } = useMe();
  const teams = useTeams();
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const q = useDebouncedValue(text, 300);
  const { open: opened, onOpen: open, onClose: close } = useDisclosure();
  const list = useBatchList({ teamId: teamId || undefined, status: status || undefined, q });
  const batches = list.data?.pages.flatMap((p) => p.items) ?? [];
  const teamName = (id: string) => teams.data?.find((x) => x.id === id)?.name ?? '';
  const mine = memberships.filter((m) => !teams.data?.find((x) => x.id === m.teamId)?.archived);
  const canCreate = mine.length > 0;
  const anyAdmin = mine.some((m) => m.role === 'admin');

  return (
    <Stack gap="4">
      <Flex justify="space-between" align="center" gap="3" wrap="wrap">
        <Heading as="h2" size="xl">{t('list.title')}</Heading>
        {canCreate && <Button onClick={open}>{anyAdmin ? t('list.new') : t('list.propose')}</Button>}
      </Flex>
      <Stack direction={{ base: 'column', md: 'row' }} align={{ md: 'flex-end' }} gap="3">
        <SelectField w={{ md: '220px' }} label={t('filters.team')} placeholder={t('filters.all')} value={teamId} onChange={setTeamId} options={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <SelectField w={{ md: '220px' }} label={t('filters.status')} placeholder={t('filters.all')} value={status} onChange={setStatus} options={BATCH_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        <FormField label={t('filters.text')} w={{ md: '260px' }}>
          <Input size="sm" value={text} onChange={(e) => setText(e.currentTarget.value)} />
        </FormField>
      </Stack>
      {list.isPending && <Spinner />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && batches.length === 0 && <Text color="fg.muted">{t('list.empty')}</Text>}
      {batches.length > 0 && (
        <TableShell minW="640px" interactive>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t('list.number')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('list.batchTitle')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('filters.team')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('filters.status')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('header.deadline')}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {batches.map((b) => (
              <Table.Row key={b.id}>
                <Table.Cell>#{b.number}</Table.Cell>
                <Table.Cell><RouteAnchor to={paths.batch(b.id)}>{b.title}</RouteAnchor></Table.Cell>
                <Table.Cell>{teamName(b.teamId)}</Table.Cell>
                <Table.Cell><BatchStatusBadge status={b.status} /></Table.Cell>
                <Table.Cell>{b.deadline ? new Date(b.deadline).toLocaleString() : '—'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </TableShell>
      )}
      {list.hasNextPage && (
        <HStack>
          <Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
      <CreateBatchModal opened={opened} onClose={close} teams={mine} defaultTeamId={teamId && mine.some((m) => m.teamId === teamId) ? teamId : undefined} />
    </Stack>
  );
}
