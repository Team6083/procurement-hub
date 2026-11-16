import { Badge, Button, Card, HStack, Input, Skeleton, Stack } from '@chakra-ui/react';
import { EmptyState, FilterBar, PageHeader, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageOpen, LuPlus } from 'react-icons/lu';
import { useDeliveryList, type DeliveryFilters } from '../api/deliveries';
import type { DeliverySummary } from '../api/types';
import { DataTable } from '../components/DataTable';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor, RouteButton } from '../components/RouteLinks';
import { FormField } from '../components/ui/field';
import { SelectField } from '../components/ui/select';
import { shortDate } from '../features/dates';
import { ReceivingGuard, useReceivingAccess } from '../features/receiving/access';
import { VoidedBadge } from '../features/receiving/StatusBadges';
import { paths } from '../paths';

function Deliveries() {
  const { t } = useTranslation('receiving');
  const { canWrite } = useReceivingAccess();
  const [filters, setFilters] = useState<DeliveryFilters>({ voided: 'false' });
  const [search, setSearch] = useState('');
  const list = useDeliveryList({ ...filters, q: search });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const activeCount = [filters.voided, filters.from, filters.to].filter(Boolean).length;

  const columns: DataColumn<DeliverySummary>[] = [
    { key: 'no', header: t('list.number'), priority: 'primary', cell: (d) => <RouteAnchor to={paths.delivery(d.id)}>{`DL-${d.number}`}</RouteAnchor> },
    { key: 'received', header: t('box.receivedAt'), cell: (d) => d.receivedAt },
    { key: 'source', header: t('box.source'), cell: (d) => d.source || '—' },
    { key: 'lines', header: t('list.lines'), numeric: true, cell: (d) => d.lineCount },
    {
      key: 'state', header: t('list.state'),
      cell: (d) => (d.voided ? <VoidedBadge /> : d.pendingLineCount > 0
        ? <Badge variant="subtle" colorPalette="orange">{t('list.pending', { count: d.pendingLineCount })}</Badge>
        : <Badge variant="subtle" colorPalette="green">{t('list.done')}</Badge>),
    },
    { key: 'note', header: t('box.note'), priority: 'secondary', cell: (d) => d.note || '—' },
    { key: 'created', header: t('list.created'), priority: 'secondary', cell: (d) => shortDate(d.createdAt) },
  ];

  return (
    <Stack gap="4">
      <PageHeader
        mb="0" title={t('list.title')} description={t('list.intro')}
        actions={canWrite && <RouteButton size="sm" colorPalette="brand" to={paths.newDelivery}><LuPlus />{t('box.title')}</RouteButton>}
      />
      <FilterBar
        mb="0" search={{ value: search, onChange: setSearch, placeholder: t('list.search') }} activeCount={activeCount} onClear={() => setFilters({})}
      >
        <SelectField
          label={t('list.voidedFilter')} placeholder={t('list.all')} value={filters.voided} onChange={(v) => setFilters({ ...filters, voided: (v || undefined) as DeliveryFilters['voided'] })}
          options={[{ value: 'false', label: t('list.active') }, { value: 'true', label: t('voided') }]}
        />
        <FormField label={t('list.from')}>
          <Input size="sm" type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.currentTarget.value || undefined })} />
        </FormField>
        <FormField label={t('list.to')}>
          <Input size="sm" type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.currentTarget.value || undefined })} />
        </FormField>
      </FilterBar>
      {list.isPending && <Skeleton h="24" rounded="l3" />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && (
        <DataTable
          aria-label={t('list.title')} rows={rows} columns={columns} getRowId={(d) => d.id}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuPackageOpen />} title={t('list.empty')} /></Card.Body></Card.Root>}
        />
      )}
      {list.hasNextPage && (
        <HStack><Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button></HStack>
      )}
    </Stack>
  );
}

/** /deliveries: every registered box, newest first. */
export function DeliveriesPage() {
  return (
    <ReceivingGuard>
      <Deliveries />
    </ReceivingGuard>
  );
}
