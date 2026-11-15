import { Badge, Button, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { PageHeader, SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useMe } from '../api/me';
import { useMeta } from '../api/meta';
import { useBatchesById, useVendorTransaction, useVendorTransactionAction } from '../api/orders';
import type { Order } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { ReasonModal } from '../components/ReasonModal';
import { RouteAnchor } from '../components/RouteLinks';
import { TableShell } from '../components/ui/table';
import { paths } from '../paths';
import { OrderStatusBadge, ProvisionalBadge, money } from '../features/orders/OrderBadges';
import { canManageVendorTransaction } from '../features/orders/vendorTransaction';
import { AllocationCard, DetailsCard, ItemPricesCard, SharedCostsCard } from '../features/orders/VendorTransactionSections';

/** External order (spec 10.3, 17.1): fees, allocation, prices and the charged amount; place or cancel a draft. */
export function VendorTransactionPage() {
  const { t } = useTranslation('orders');
  const { id = '' } = useParams();
  const { me } = useMe();
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const q = useVendorTransaction(id);
  const view = q.data?.data;
  const batchQs = useBatchesById(view?.batchIds ?? []);
  const action = useVendorTransactionAction(id);
  const [dialog, setDialog] = useState<'place' | 'cancel' | null>(null);

  if (q.isPending) return <Skeleton h="32" rounded="l3" />;
  if (q.error || !view) return <ErrorAlert error={q.error} />;

  const batches = batchQs.flatMap((r) => (r.data ? [r.data.data] : []));
  const batchNumber = new Map(batches.map((b) => [b.id, b.number]));
  const loadedAll = batches.length === view.batchIds.length;
  const manage = loadedAll && canManageVendorTransaction(me, batches, view.hiddenOrderCount);
  const live = view.status !== 'cancelled';
  const editable = manage && live;
  const draft = view.status === 'draft';
  const orderLabel = (o: Order) => t('vt.orderLabel', { batch: batchNumber.get(o.batchId) ?? '…', number: o.number });
  const run = (a: 'place' | 'cancel') => action.mutate(a, { onSuccess: () => setDialog(null) });

  return (
    <Stack gap="4">
      <PageHeader
        mb="0"
        title={view.status === 'placed' && view.externalOrderNo ? `${view.vendor} · ${view.externalOrderNo}` : view.vendor}
        badge={<OrderStatusBadge status={view.status} />}
        description={[view.currency, view.placedAt && t('vt.placedAt', { date: new Date(view.placedAt).toLocaleString() })].filter(Boolean).join(' · ')}
        actions={manage && draft && (
          <HStack wrap="wrap">
            <Button variant="outline" colorPalette="red" onClick={() => { action.reset(); setDialog('cancel'); }}>{t('vt.cancel')}</Button>
            <Button onClick={() => { action.reset(); setDialog('place'); }}>{t('vt.place')}</Button>
          </HStack>
        )}
      />
      {!manage && <Notice>{view.hiddenOrderCount > 0 ? t('vt.readOnlyHidden') : t('vt.readOnly')}</Notice>}
      {view.hiddenOrderCount > 0 && (
        <Notice status="info">{t('vt.hidden', { count: view.hiddenOrderCount, amount: money(view.hiddenOrdersTotalBase), currency: base })}</Notice>
      )}
      {dialog === null && <ErrorAlert error={action.error} />}

      <Stack gap="3">
        <SectionHeader title={t('vt.orders')} count={view.orders.length} mb="0" />
        <TableShell minW="720px">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t('orders.number')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('orders.status')}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t('cost.items', { currency: base })}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t('cost.shared')}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t('cost.adjustments')}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t('cost.total')}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {view.orders.map(({ order }) => (
              <Table.Row key={order.id}>
                <Table.Cell><RouteAnchor to={paths.batch(order.batchId)}>{orderLabel(order)}</RouteAnchor></Table.Cell>
                <Table.Cell><OrderStatusBadge status={order.status} /></Table.Cell>
                <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(order.itemsCostBase)}</Table.Cell>
                <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(order.sharedCostBase)}</Table.Cell>
                <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(order.adjustmentsBase)}</Table.Cell>
                <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                  <HStack justify="flex-end" gap="2">
                    {order.costsProvisional && <ProvisionalBadge />}
                    <Text as="span" fontWeight="semibold">{money(order.totalBase)}</Text>
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </TableShell>
        {view.chargedAmountBase === null && <Badge alignSelf="flex-start" variant="subtle" colorPalette="orange">{t('vt.noCharged')}</Badge>}
      </Stack>

      {/* Each card restarts from the server copy only when its own data changed, so pending edits in the others survive. */}
      <DetailsCard key={JSON.stringify([view.vendor, view.externalOrderNo, view.paymentNote, view.expectedDeliveryDate, view.chargedAmountBase])} view={view} editable={editable} base={base} />
      <SharedCostsCard key={JSON.stringify(view.sharedCosts)} view={view} editable={editable} />
      <AllocationCard key={JSON.stringify([view.allocations, view.allocationOverrideReason, view.sharedCosts])} view={view} editable={editable} orderLabel={orderLabel} />
      <ItemPricesCard key={JSON.stringify(view.orders.flatMap((d) => d.items.map((i) => [i.id, i.actualUnitPrice, i.actualCostBase])))} view={view} editable={editable} orderLabel={orderLabel} />

      <ReasonModal
        opened={dialog === 'place'}
        title={t('vt.place')}
        body={t('vt.placeConfirm')}
        confirmLabel={t('vt.place')}
        loading={action.isPending}
        error={action.error}
        onClose={() => setDialog(null)}
        onConfirm={() => run('place')}
      />
      <ReasonModal
        opened={dialog === 'cancel'}
        title={t('vt.cancel')}
        body={t('vt.cancelConfirm')}
        confirmLabel={t('vt.cancel')}
        danger
        loading={action.isPending}
        error={action.error}
        onClose={() => setDialog(null)}
        onConfirm={() => run('cancel')}
      />
    </Stack>
  );
}
