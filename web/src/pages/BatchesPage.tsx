import { Button, Card, HStack, Skeleton, Stack, Text, useDisclosure } from '@chakra-ui/react';
import { EmptyState, FilterBar, PageHeader } from '@team6083/ui';
import { DataTable } from '../components/DataTable';
import { LuPackage, LuPlus } from 'react-icons/lu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import type { BatchStatus } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { SelectField } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { paths } from '../paths';
import { CreateBatchModal } from '../features/batches/CreateBatchModal';
import { BatchStatusBadge } from '../features/batches/StatusBadges';
import { shortDate } from '../features/dates';

export const BATCH_STATUSES: BatchStatus[] = ['proposed', 'proposal_rejected', 'draft', 'collecting', 'reviewing', 'purchasing', 'receiving', 'completed', 'cancelled'];

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
      <PageHeader
        title={t('list.title')}
        mb="0"
        actions={
          canCreate && (
            <Button size="sm" onClick={open}>
              <LuPlus />
              {anyAdmin ? t('list.new') : t('list.propose')}
            </Button>
          )
        }
      />
      <FilterBar
        mb="0"
        search={{ value: text, onChange: setText, placeholder: t('filters.text') }}
        activeCount={[teamId, status].filter(Boolean).length}
        onClear={() => { setTeamId(''); setStatus(''); }}
      >
        <SelectField size="sm" label={t('filters.team')} placeholder={t('filters.all')} value={teamId} onChange={setTeamId} options={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <SelectField size="sm" label={t('filters.status')} placeholder={t('filters.all')} value={status} onChange={setStatus} options={BATCH_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
      </FilterBar>
      {list.isPending && <Skeleton h="24" rounded="l3" />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && batches.length === 0 && (
        <Card.Root size="sm">
          <Card.Body>
            <EmptyState icon={<LuPackage />} title={t('list.empty')} />
          </Card.Body>
        </Card.Root>
      )}
      {batches.length > 0 && (
        <DataTable
          aria-label={t('list.title')}
          rows={batches}
          getRowId={(b) => b.id}
          columns={[
            {
              key: 'title', header: t('list.batchTitle'), priority: 'primary',
              cell: (b) => (
                <>
                  <Text as="span" color="fg.muted" fontWeight="normal" fontVariantNumeric="tabular-nums" me="1.5">#{b.number}</Text>
                  <RouteAnchor to={paths.batch(b.id)}>{b.title}</RouteAnchor>
                </>
              ),
            },
            { key: 'team', header: t('filters.team'), cell: (b) => teamName(b.teamId) },
            { key: 'status', header: t('filters.status'), cell: (b) => <BatchStatusBadge status={b.status} /> },
            { key: 'deadline', header: t('header.deadline'), cell: (b) => <Text as="span" fontVariantNumeric="tabular-nums">{shortDate(b.deadline)}</Text> },
          ]}
        />
      )}
      {list.hasNextPage && (
        <HStack>
          <Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
      <CreateBatchModal opened={opened} onClose={close} teams={mine} defaultTeamId={teamId && mine.some((m) => m.teamId === teamId) ? teamId : undefined} />
    </Stack>
  );
}
