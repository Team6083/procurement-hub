import { orderLabel } from '../features/labels';
import { Badge, Button, Card, HStack, NativeSelect, Stack } from '@chakra-ui/react';
import { FormField } from '../components/ui/field';
import { DataTable, EmptyState, FilterBar, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LuShoppingCart } from 'react-icons/lu';
import { useTeams } from '../api/teams';
import type { VendorOrderSummary } from '../api/types';
import { useVendorOrderList, type OrderFilters } from '../api/vendorOrders';
import { useVendors } from '../api/vendors';
import { ErrorAlert } from '../components/ErrorAlert';
import { ListSkeleton } from '../components/PageStates';
import { RouteAnchor } from '../components/RouteLinks';
import { useBaseCurrency } from '../api/meta';
import { shortDate } from '../features/dates';
import { formatMoney } from '../features/money';
import { OrderProgressBadges, OrderStatusBadge, ProvisionalBadge } from '../features/orders/StatusBadges';
import { paths } from '../paths';

/** Vendor orders the caller can see; regular users only reach the ones holding their team's lines. */
export function VendorOrdersPage() {
  const { t, i18n } = useTranslation('purchasing');
  const baseCurrency = useBaseCurrency();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<OrderFilters>(() => ({ status: params.get('status') || undefined, ownerId: params.get('ownerId') || undefined }));
  const [search, setSearch] = useState('');
  const list = useVendorOrderList({ ...filters, q: search });
  const vendors = useVendors(true).data ?? [];
  const teams = useTeams().data ?? [];
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (k: keyof OrderFilters) => (v: string) => setFilters({ ...filters, [k]: v || undefined });
  const activeCount = [filters.status, filters.vendorId, filters.teamId, filters.ownerId, filters.completed, filters.receivingState, filters.accountingState].filter(Boolean).length;

  const columns: DataColumn<VendorOrderSummary>[] = [
    { key: 'no', header: t('list.number'), priority: 'primary', cell: (o) => <RouteAnchor to={paths.vendorOrder(o.id)}>{orderLabel(o.number)}</RouteAnchor> },
    { key: 'vendor', header: t('list.vendor'), cell: (o) => o.vendorName },
    { key: 'status', header: t('line.status'), cell: (o) => <HStack gap="2"><OrderStatusBadge status={o.status} />{o.provisional && <ProvisionalBadge />}</HStack> },
    { key: 'progress', header: t('progress.title'), cell: (o) => <HStack gap="2" wrap="wrap"><OrderProgressBadges order={o} /></HStack> },
    { key: 'owners', header: t('list.owners'), priority: 'secondary', cell: (o) => o.owners.map((x) => x.displayName).join(', ') || '—' },
    { key: 'ext', header: t('details.externalNo'), priority: 'secondary', cell: (o) => o.externalOrderNo || '—' },
    { key: 'teams', header: t('list.teams'), priority: 'secondary', cell: (o) => o.teamIds.map((id) => teams.find((x) => x.id === id)?.name ?? t('common:unknownTeam')).join(', ') },
    { key: 'lines', header: t('list.lines'), numeric: true, cell: (o) => (o.restricted ? <Badge variant="outline">{t('list.visibleLines', { count: o.lineCount })}</Badge> : o.lineCount) },
    { key: 'net', header: t('breakdown.net'), numeric: true, cell: (o) => (o.restricted ? '—' : formatMoney(o.netBase, baseCurrency, i18n.language)) },
    { key: 'placed', header: t('details.placedAt'), priority: 'secondary', cell: (o) => shortDate(o.placedAt) },
  ];

  return (
    <Stack gap="4">
      <FilterBar
        mb="0" search={{ value: search, onChange: setSearch, placeholder: t('list.search') }} activeCount={activeCount} onClear={() => setFilters({})}
      >
        <FormField label={t('line.status')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.status ?? ''}
              onChange={(e) => set('status')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              {['draft', 'placed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{t(`orderStatus.${s}`)}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('progress.title')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.completed ?? ''}
              onChange={(e) => set('completed')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              <option value="false">{t('progress.notCompleted')}</option>
              <option value="true">{t('progress.completed')}</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('progress.receiving')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.receivingState ?? ''}
              onChange={(e) => set('receivingState')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              {['none', 'partial', 'closed'].map((s) => (
                <option key={s} value={s}>{t(`progress.receivingState.${s}`)}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('progress.accounting')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.accountingState ?? ''}
              onChange={(e) => set('accountingState')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              {['incomplete', 'provisional', 'final'].map((s) => (
                <option key={s} value={s}>{t(`progress.accountingState.${s}`)}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('list.vendor')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.vendorId ?? ''}
              onChange={(e) => set('vendorId')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('line.team')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.teamId ?? ''}
              onChange={(e) => set('teamId')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField label={t('list.owner')}>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={filters.ownerId ?? ''}
              onChange={(e) => set('ownerId')(e.currentTarget.value)}
            >
              <option value="">{t('list.all')}</option>
              <option value="me">{t('list.ownerMine')}</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
      </FilterBar>
      {list.isPending && <ListSkeleton />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && (
        <DataTable
          aria-label={t('list.title')} rows={rows} columns={columns} getRowId={(o) => o.id}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuShoppingCart />} title={t('list.empty')} /></Card.Body></Card.Root>}
        />
      )}
      {list.hasNextPage && (
        <HStack><Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button></HStack>
      )}
    </Stack>
  );
}
