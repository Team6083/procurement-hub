import { Badge, Button, HStack, Skeleton, Stack, Text } from '@chakra-ui/react';
import { PageHeader, SectionHeader } from '@team6083/ui';
import { DataTable } from '../components/DataTable';
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
import { paths } from '../paths';
import { shortDate } from '../features/dates';
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
        description={[view.currency, view.placedAt && t('vt.placedAt', { date: shortDate(view.placedAt) })].filter(Boolean).join(' · ')}
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
        <DataTable
          aria-label={t('vt.orders')}
          rows={view.orders}
          getRowId={(d) => d.order.id}
          columns={[
            { key: 'order', header: t('orders.number'), priority: 'primary', cell: ({ order }) => <RouteAnchor to={paths.batch(order.batchId)}>{orderLabel(order)}</RouteAnchor> },
            { key: 'status', header: t('orders.status'), cell: ({ order }) => <OrderStatusBadge status={order.status} /> },
            { key: 'items', header: t('cost.items', { currency: base }), numeric: true, priority: 'secondary', cell: ({ order }) => money(order.itemsCostBase) },
            { key: 'shared', header: t('cost.shared'), numeric: true, priority: 'secondary', cell: ({ order }) => money(order.sharedCostBase) },
            { key: 'adjustments', header: t('cost.adjustments'), numeric: true, priority: 'secondary', cell: ({ order }) => money(order.adjustmentsBase) },
            {
              key: 'total', header: t('cost.total'), numeric: true,
              cell: ({ order }) => (
                <HStack as="span" justify="flex-end" gap="2">
                  {order.costsProvisional && <ProvisionalBadge />}
                  <Text as="span" fontWeight="semibold">{money(order.totalBase)}</Text>
                </HStack>
              ),
            },
          ]}
        />
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
