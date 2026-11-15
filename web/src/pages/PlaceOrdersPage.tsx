import { Button, HStack, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader, SectionHeader, SelectionBar } from '@team6083/ui';
import { DataTable } from '../components/DataTable';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageCheck, LuShoppingCart } from 'react-icons/lu';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useItemsOf, useOrdersOf } from '../api/orders';
import { useTeams } from '../api/teams';
import type { Batch, Item } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { callerFor } from '../features/batches/rules';
import { PlaceOrderDialog, type PlaceSnapshot } from '../features/orders/PlaceOrderDialog';
import { OrderStatusBadge, money } from '../features/orders/OrderBadges';
import {
  availableRows, externalOrderGroups, planOrders, readyItemRows, selectedItemRows, selectedRows,
} from '../features/orders/placeOrders';
import { paths } from '../paths';

/**
 * Place orders (spec 10.3): approved items waiting for an order from every ordering batch plus existing draft orders, selectable across
 * batches and teams (items and drafts can go into one external order), and the external orders in progress.
 */
export function PlaceOrdersPage() {
  const { t } = useTranslation('orders');
  const { me } = useMe();
  const teams = useTeams();
  const list = useBatchList({ status: 'ordering' });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const batches = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data]);
  const batchIds = useMemo(() => batches.map((b) => b.id), [batches]);
  const orderQs = useOrdersOf(batchIds);
  const itemQs = useItemsOf(batchIds);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [itemSelection, setItemSelection] = useState<Record<string, boolean>>({});
  const [snapshot, setSnapshot] = useState<PlaceSnapshot | null>(null);

  const ordersByBatch = Object.fromEntries(batchIds.map((id, i) => [id, orderQs[i]?.data]));
  const itemsByBatch = Object.fromEntries(batchIds.map((id, i) => [id, itemQs[i]?.data as Item[] | undefined]));
  const callerOf = (b: { teamId: string }) => callerFor(me, b.teamId);
  const rows = availableRows(batches, ordersByBatch, callerOf);
  const itemRows = readyItemRows(batches, itemsByBatch, callerOf);
  const chosen = selectedRows(rows, selection);
  const chosenItems = selectedItemRows(itemRows, itemSelection);
  const total = chosen.length + chosenItems.length;
  const inProgress = externalOrderGroups(batches, ordersByBatch);
  const teamName = (id: string) => teams.data?.find((x) => x.id === id)?.name ?? '';
  const batchLabel = (b: { number: number; title: string }) => `#${b.number} ${b.title}`;
  const open = () => setSnapshot({ plans: planOrders(chosenItems), drafts: chosen.map((r) => r.order), items: [...chosenItems.map((r) => r.item), ...chosen.flatMap((r) => (itemsByBatch[r.batch.id] ?? []).filter((i) => r.order.itemIds.includes(i.id)))] });

  const loading = list.isPending || (batchIds.length > 0 && (orderQs.some((q) => q.isPending) || itemQs.some((q) => q.isPending))) || hasNextPage;
  const failed = orderQs.some((q) => q.error) || itemQs.some((q) => q.error);
  const mayOrder = rows.some((r) => r.selectable) || itemRows.some((r) => r.selectable);

  const ids = (sel: Record<string, boolean>) => Object.keys(sel).filter((k) => sel[k]);
  const fromIds = (list: string[]) => Object.fromEntries(list.map((k) => [k, true]));
  const clear = () => { setSelection({}); setItemSelection({}); };
  const batchCell = (batch: Batch, selectable: boolean) => (
    <Stack as="span" gap="0" textAlign="start">
      <RouteAnchor to={paths.batch(batch.id)}>{batchLabel(batch)}</RouteAnchor>
      {!selectable && <Text as="span" textStyle="xs" color="fg.muted">{t('place.notPurchaser')}</Text>}
    </Stack>
  );
  const vendorLabel = (vendor: string) => vendor || t('place.noVendor');

  return (
    <Stack gap="8">
      <PageHeader title={t('place.title')} description={t('place.description')} mb="0" />
      {list.error && <ErrorAlert error={list.error} />}
      {failed && <Notice>{t('place.loadError')}</Notice>}

      <Stack gap="3">
        <SectionHeader title={t('place.ready')} count={loading ? undefined : itemRows.length} mb="0" />
        {loading ? (
          <Skeleton h="24" rounded="l3" />
        ) : itemRows.length === 0 && rows.length === 0 ? (
          <EmptyState icon={<LuShoppingCart />} title={t('place.empty')} description={t('place.emptyBody')} />
        ) : itemRows.length === 0 ? (
          <Text color="fg.muted">{t('place.noItems')}</Text>
        ) : (
          <DataTable
            aria-label={t('place.ready')}
            rows={itemRows}
            getRowId={(r) => r.item.id}
            selection={{ selected: ids(itemSelection), onChange: (l) => setItemSelection(fromIds(l)), canSelect: (r) => r.selectable }}
            groupBy={(r) => r.item.vendor.trim()}
            groupLabel={(vendor) => vendorLabel(vendor)}
            columns={[
              { key: 'item', header: t('place.item'), priority: 'primary', cell: (r) => r.item.name },
              { key: 'quantity', header: t('place.quantity'), numeric: true, cell: (r) => r.item.quantity },
              { key: 'estimate', header: t('place.estimate'), numeric: true, cell: (r) => `${money(r.item.estimatedUnitPrice.amount)} ${r.item.estimatedUnitPrice.currency}` },
              { key: 'batch', header: t('place.batch'), cell: (r) => batchCell(r.batch, r.selectable) },
              { key: 'team', header: t('place.team'), priority: 'secondary', cell: (r) => teamName(r.batch.teamId) },
            ]}
          />
        )}
      </Stack>

      {!loading && rows.length > 0 && (
        <Stack gap="3">
          <SectionHeader title={t('place.drafts')} count={rows.length} mb="0" />
          <Text color="fg.muted">{t('place.draftsHint')}</Text>
          <DataTable
            aria-label={t('place.drafts')}
            rows={rows}
            getRowId={(r) => r.order.id}
            selection={{ selected: ids(selection), onChange: (l) => setSelection(fromIds(l)), canSelect: (r) => r.selectable }}
            groupBy={(r) => r.order.vendor}
            groupLabel={(vendor) => vendorLabel(vendor)}
            columns={[
              { key: 'order', header: t('orders.number'), priority: 'primary', cell: (r) => `#${r.order.number}` },
              { key: 'batch', header: t('place.batch'), cell: (r) => batchCell(r.batch, r.selectable) },
              { key: 'team', header: t('place.team'), priority: 'secondary', cell: (r) => teamName(r.batch.teamId) },
              { key: 'items', header: t('place.items'), numeric: true, cell: (r) => r.order.itemIds.length },
              { key: 'total', header: t('cost.total'), numeric: true, cell: (r) => money(r.order.totalBase) },
            ]}
          />
        </Stack>
      )}

      <Stack gap="3">
        <SectionHeader title={t('place.inProgress')} count={loading ? undefined : inProgress.length} mb="0" />
        {loading ? (
          <Skeleton h="16" rounded="l3" />
        ) : (
          <DataTable
            aria-label={t('place.inProgress')}
            rows={inProgress}
            getRowId={(g) => g.id}
            empty={<EmptyState icon={<LuPackageCheck />} title={t('place.noExternal')} description={t('place.noExternalBody')} />}
            columns={[
              { key: 'vendor', header: t('create.vendor'), priority: 'primary', cell: (g) => <RouteAnchor to={paths.vendorTransaction(g.id)}>{g.vendor}</RouteAnchor> },
              { key: 'status', header: t('orders.status'), cell: (g) => <OrderStatusBadge status={g.status} /> },
              {
                key: 'orders', header: t('vt.orders'),
                cell: (g) => (
                  <HStack as="span" gap="2" wrap="wrap">
                    <Text as="span" color="fg.muted">{t('place.ordersCount', { count: g.orders.length })}</Text>
                    <Text as="span">{[...new Set(g.orders.map((o) => `#${o.batch.number}`))].join(', ')}</Text>
                  </HStack>
                ),
              },
              { key: 'open', header: '', label: '', cell: (g) => <RouteAnchor to={paths.vendorTransaction(g.id)}>{t('place.openExternal')}</RouteAnchor> },
            ]}
          />
        )}
      </Stack>

      <SelectionBar count={total} onClear={clear}>
        {mayOrder && <Button size="sm" onClick={open}>{t('external.create')}</Button>}
      </SelectionBar>
      <PlaceOrderDialog snapshot={snapshot} onClose={() => setSnapshot(null)} onPlaced={clear} />
    </Stack>
  );
}
