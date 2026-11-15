import { Button, Checkbox, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader, SectionHeader } from '@team6083/ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageCheck, LuShoppingCart } from 'react-icons/lu';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useItemsOf, useOrdersOf } from '../api/orders';
import { useTeams } from '../api/teams';
import type { Item } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { TableShell } from '../components/ui/table';
import { callerFor } from '../features/batches/rules';
import { ExternalOrderModal } from '../features/orders/ExternalOrderModal';
import { OrderStatusBadge, money } from '../features/orders/OrderBadges';
import { availableRows, externalOrderGroups, groupByVendor, selectedRows, toggleGroup } from '../features/orders/placeOrders';
import { paths } from '../paths';

/** Place orders (spec 10.3): draft orders of every ordering batch, selectable across batches and teams, plus the external orders in progress. */
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
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [external, setExternal] = useState(false);

  const ordersByBatch = Object.fromEntries(batchIds.map((id, i) => [id, orderQs[i]?.data]));
  const callerOf = (b: { teamId: string }) => callerFor(me, b.teamId);
  const rows = availableRows(batches, ordersByBatch, callerOf);
  const groups = groupByVendor(rows);
  const chosen = selectedRows(rows, selection);
  const chosenBatchIds = [...new Set(chosen.map((r) => r.batch.id))];
  const itemQs = useItemsOf(chosenBatchIds);
  const chosenItems = itemQs.flatMap((q) => (q.data ?? []) as Item[]);
  const inProgress = externalOrderGroups(batches, ordersByBatch);
  const teamName = (id: string) => teams.data?.find((x) => x.id === id)?.name ?? '';
  const batchLabel = (b: { number: number; title: string }) => `#${b.number} ${b.title}`;

  const loading = list.isPending || (batchIds.length > 0 && orderQs.some((q) => q.isPending)) || hasNextPage;
  const failed = orderQs.some((q) => q.error);
  const mayOrder = rows.some((r) => r.selectable);

  return (
    <Stack gap="8">
      <PageHeader title={t('place.title')} description={t('place.description')} mb="0" />
      {list.error && <ErrorAlert error={list.error} />}
      {failed && <Notice>{t('place.loadError')}</Notice>}

      <Stack gap="3">
        <SectionHeader
          title={t('place.ready')}
          count={loading ? undefined : rows.length}
          mb="0"
          actions={mayOrder && (
            <Button disabled={chosen.length === 0} onClick={() => setExternal(true)}>
              {t('place.createExternal', { count: chosen.length })}
            </Button>
          )}
        />
        {loading ? (
          <Skeleton h="24" rounded="l3" />
        ) : rows.length === 0 ? (
          <EmptyState icon={<LuShoppingCart />} title={t('place.empty')} description={t('place.emptyBody')} />
        ) : (
          <TableShell minW="800px">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader w="8" />
                <Table.ColumnHeader>{t('orders.number')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('place.batch')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('place.team')}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('place.items')}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('cost.total')}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groups.flatMap((g) => {
                const pickable = g.rows.filter((r) => r.selectable);
                const all = pickable.length > 0 && pickable.every((r) => selection[r.order.id]);
                return [
                  <Table.Row key={`g:${g.vendor}`} bg="bg.muted">
                    <Table.Cell>
                      {pickable.length > 0 && (
                        <Checkbox.Root size="sm" checked={all} onCheckedChange={(e) => setSelection((s) => toggleGroup(s, g.rows, !!e.checked))}>
                          <Checkbox.HiddenInput aria-label={t('place.selectVendor', { vendor: g.vendor })} />
                          <Checkbox.Control />
                        </Checkbox.Root>
                      )}
                    </Table.Cell>
                    <Table.Cell colSpan={5} fontWeight="semibold">{g.vendor}</Table.Cell>
                  </Table.Row>,
                  ...g.rows.map(({ order, batch, selectable }) => (
                    <Table.Row key={order.id}>
                      <Table.Cell>
                        <Checkbox.Root size="sm" disabled={!selectable} checked={!!selection[order.id] && selectable} onCheckedChange={(e) => setSelection((s) => ({ ...s, [order.id]: !!e.checked }))}>
                          <Checkbox.HiddenInput aria-label={t('orders.select', { number: order.number })} title={selectable ? undefined : t('place.notPurchaser')} />
                          <Checkbox.Control />
                        </Checkbox.Root>
                      </Table.Cell>
                      <Table.Cell fontVariantNumeric="tabular-nums">#{order.number}</Table.Cell>
                      <Table.Cell><RouteAnchor to={paths.batch(batch.id)}>{batchLabel(batch)}</RouteAnchor></Table.Cell>
                      <Table.Cell>{teamName(batch.teamId)}</Table.Cell>
                      <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{order.itemIds.length}</Table.Cell>
                      <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(order.totalBase)}</Table.Cell>
                    </Table.Row>
                  )),
                ];
              })}
            </Table.Body>
          </TableShell>
        )}
      </Stack>

      <Stack gap="3">
        <SectionHeader title={t('place.inProgress')} count={loading ? undefined : inProgress.length} mb="0" />
        {loading ? (
          <Skeleton h="16" rounded="l3" />
        ) : inProgress.length === 0 ? (
          <EmptyState icon={<LuPackageCheck />} title={t('place.noExternal')} description={t('place.noExternalBody')} />
        ) : (
          <TableShell minW="640px">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t('create.vendor')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('orders.status')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('vt.orders')}</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {inProgress.map((g) => (
                <Table.Row key={g.id}>
                  <Table.Cell>{g.vendor}</Table.Cell>
                  <Table.Cell><OrderStatusBadge status={g.status} /></Table.Cell>
                  <Table.Cell>
                    <HStack gap="2" wrap="wrap">
                      <Text as="span" color="fg.muted">{t('place.ordersCount', { count: g.orders.length })}</Text>
                      <Text as="span">{[...new Set(g.orders.map((o) => `#${o.batch.number}`))].join(', ')}</Text>
                    </HStack>
                  </Table.Cell>
                  <Table.Cell textAlign="end"><RouteAnchor to={paths.vendorTransaction(g.id)}>{t('place.openExternal')}</RouteAnchor></Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </TableShell>
        )}
      </Stack>

      <ExternalOrderModal opened={external} orders={chosen.map((r) => r.order)} items={chosenItems} onClose={() => { setExternal(false); setSelection({}); }} />
    </Stack>
  );
}
