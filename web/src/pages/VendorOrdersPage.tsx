import { Badge, Button, Card, HStack, Skeleton, Stack } from '@chakra-ui/react';
import { EmptyState, FilterBar, PageHeader, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuShoppingCart } from 'react-icons/lu';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import type { VendorOrderSummary } from '../api/types';
import { useVendorOrderList, type OrderFilters } from '../api/vendorOrders';
import { useVendors } from '../api/vendors';
import { DataTable } from '../components/DataTable';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor, RouteButton } from '../components/RouteLinks';
import { SelectField } from '../components/ui/select';
import { useMeta } from '../api/meta';
import { shortDate } from '../features/dates';
import { formatMoney } from '../features/orders/money';
import { OrderStatusBadge, ProvisionalBadge } from '../features/orders/StatusBadges';
import { paths } from '../paths';

/** Vendor orders the caller can see; regular users only reach the ones holding their team's lines. */
export function VendorOrdersPage() {
  const { t, i18n } = useTranslation('purchasing');
  const { me } = useMe();
  const baseCurrency = useMeta().data?.baseCurrency ?? 'USD';
  const [filters, setFilters] = useState<OrderFilters>({});
  const [search, setSearch] = useState('');
  const list = useVendorOrderList({ ...filters, q: search });
  const vendors = useVendors(true).data ?? [];
  const teams = useTeams().data ?? [];
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof OrderFilters) => (v: string) => setFilters({ ...filters, [k]: v || undefined });
  const activeCount = [filters.status, filters.vendorId, filters.teamId].filter(Boolean).length;

  const columns: DataColumn<VendorOrderSummary>[] = [
    { key: 'no', header: t('list.number'), priority: 'primary', cell: (o) => <RouteAnchor to={paths.vendorOrder(o.id)}>{`VO-${o.number}`}</RouteAnchor> },
    { key: 'vendor', header: t('list.vendor'), cell: (o) => o.vendorName },
    { key: 'status', header: t('line.status'), cell: (o) => <HStack gap="2"><OrderStatusBadge status={o.status} />{o.provisional && <ProvisionalBadge />}</HStack> },
    { key: 'ext', header: t('details.externalNo'), priority: 'secondary', cell: (o) => o.externalOrderNo || '—' },
    { key: 'teams', header: t('list.teams'), priority: 'secondary', cell: (o) => o.teamIds.map((id) => teams.find((x) => x.id === id)?.name ?? '…').join(', ') },
    { key: 'lines', header: t('list.lines'), numeric: true, cell: (o) => (o.restricted ? <Badge variant="outline">{t('list.visibleLines', { count: o.lineCount })}</Badge> : o.lineCount) },
    { key: 'net', header: t('breakdown.net'), numeric: true, cell: (o) => (o.restricted ? '—' : formatMoney(o.netBase, baseCurrency, i18n.language)) },
    { key: 'placed', header: t('details.placedAt'), priority: 'secondary', cell: (o) => shortDate(o.placedAt) },
  ];

  return (
    <Stack gap="4">
      <PageHeader
        mb="0" title={t('list.title')} description={t('list.intro')}
        actions={me?.isPurchaser && <RouteButton size="sm" to={paths.purchasing}><LuShoppingCart />{t('queue.title')}</RouteButton>}
      />
      <FilterBar
        mb="0" search={{ value: search, onChange: setSearch, placeholder: t('list.search') }} activeCount={activeCount} onClear={() => setFilters({})}
      >
        <SelectField label={t('line.status')} placeholder={t('list.all')} value={filters.status} onChange={set('status')}
          options={['draft', 'placed', 'cancelled'].map((s) => ({ value: s, label: t(`orderStatus.${s}`) }))} />
        <SelectField label={t('list.vendor')} placeholder={t('list.all')} value={filters.vendorId} onChange={set('vendorId')} options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
        <SelectField label={t('line.team')} placeholder={t('list.all')} value={filters.teamId} onChange={set('teamId')} options={teams.map((x) => ({ value: x.id, label: x.name }))} />
      </FilterBar>
      {list.isPending && <Skeleton h="24" rounded="l3" />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && (
        <DataTable
          aria-label={t('list.title')} rows={rows} columns={columns} getRowId={(o) => o.id}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuShoppingCart />} title={t('list.empty')} /></Card.Body></Card.Root>}
        />
      )}
      {list.hasNextPage && (
        <HStack><Button variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button></HStack>
      )}
    </Stack>
  );
}
