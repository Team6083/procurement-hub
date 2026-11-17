import { deliveryLabel } from '../features/labels';
import { Badge, Button, Card, HStack, Input, Stack } from '@chakra-ui/react';
import { EmptyState, FilterBar, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageOpen } from 'react-icons/lu';
import { useDeliveryList, type DeliveryFilters } from '../api/deliveries';
import type { DeliverySummary } from '../api/types';
import { DataTable } from '../components/DataTable';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { FormField } from '../components/ui/field';
import { SelectField } from '../components/ui/select';
import { shortDate, shortDay } from '../features/dates';
import { VoidedBadge } from '../features/receiving/StatusBadges';
import { paths } from '../paths';
import { ListSkeleton } from '../components/PageStates';

/** Voided boxes are hidden until asked for; that default is not a filter the user set. */
const DEFAULT_FILTERS: DeliveryFilters = { voided: 'false' };

/** /deliveries: every registered box, newest first; the second tab of the Receiving page (ReceivingLayout). */
export function DeliveriesPage() {
  const { t } = useTranslation('receiving');
  const [filters, setFilters] = useState<DeliveryFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const list = useDeliveryList({ ...filters, q: search });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const activeCount = [filters.voided !== DEFAULT_FILTERS.voided, filters.from, filters.to].filter(Boolean).length;

  const columns: DataColumn<DeliverySummary>[] = [
    { key: 'no', header: t('list.number'), priority: 'primary', cell: (d) => <RouteAnchor to={paths.delivery(d.id)}>{deliveryLabel(d.number)}</RouteAnchor> },
    { key: 'received', header: t('box.receivedAt'), cell: (d) => shortDay(d.receivedAt) },
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
      <FilterBar
        mb="0" search={{ value: search, onChange: setSearch, placeholder: t('list.search') }} activeCount={activeCount} onClear={() => setFilters(DEFAULT_FILTERS)}
      >
        <SelectField size="sm"
          label={t('list.voidedFilter')} placeholder={t('list.all')} value={filters.voided} onChange={(v) => setFilters({ ...filters, voided: v || undefined })}
          options={[{ value: 'false', label: t('list.active') }, { value: 'true', label: t('voided') }]}
        />
        <FormField label={t('list.from')}>
          <Input size="sm" type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.currentTarget.value || undefined })} />
        </FormField>
        <FormField label={t('list.to')}>
          <Input size="sm" type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.currentTarget.value || undefined })} />
        </FormField>
      </FilterBar>
      {list.isPending && <ListSkeleton />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && (
        <DataTable
          aria-label={t('list.title')} rows={rows} columns={columns} getRowId={(d) => d.id}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuPackageOpen />} title={t('list.empty')} /></Card.Body></Card.Root>}
        />
      )}
      {list.hasNextPage && (
        <HStack><Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button></HStack>
      )}
    </Stack>
  );
}
