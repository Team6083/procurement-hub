import { Button, HStack, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader, SelectionBar, Totals, type RowAction } from '@team6083/ui';
import { DataTable } from '../../components/DataTable';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPencil, LuScale, LuShoppingCart, LuX } from 'react-icons/lu';
import { useMeta } from '../../api/meta';
import { useCancelOrder, useOrders } from '../../api/orders';
import type { Batch, Item, Order } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { ZERO, add, format, parseDecSafe } from '../batches/decimal';
import type { Caller } from '../batches/rules';
import { AdjustmentModal } from './AdjustmentModal';
import { EditOrderModal } from './EditOrderModal';
import { ExternalOrderModal } from './ExternalOrderModal';
import { OrderStatusBadge, ProvisionalBadge, money } from './OrderBadges';
import {
  canAdjust, canChangeOrder, canCreateVendorTransaction, isAvailableOrder,
} from './rules';

interface Props {
  batch: Batch;
  caller: Caller;
  items: Item[];
}

export function OrdersTab({ batch, caller, items }: Props) {
  const { t } = useTranslation('orders');
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const orders = useOrders(batch.id);
  const cancel = useCancelOrder(batch.id);
  const [orderSel, setOrderSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<Order | null>(null);
  const [adjusting, setAdjusting] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [external, setExternal] = useState(false);

  const list = orders.data ?? [];
  const selectedOrders = list.filter((o) => orderSel.includes(o.id) && isAvailableOrder(o));
  const mayExternal = canCreateVendorTransaction(batch, caller);
  const itemName = (id: string) => items.find((i) => i.id === id)?.name;

  if (orders.isPending) return <Skeleton h="24" rounded="l3" />;
  if (orders.error) return <ErrorAlert error={orders.error} />;

  const actionsOf = (o: Order): RowAction[] => [
    ...(canChangeOrder(o, batch, caller) ? [{ value: 'edit', icon: <LuPencil />, label: t('common:actions.edit'), onSelect: () => setEditing(o) }] : []),
    ...(canAdjust(o, batch, caller) ? [{ value: 'adjust', icon: <LuScale />, label: t('adjust.button'), onSelect: () => setAdjusting(o) }] : []),
    ...(canChangeOrder(o, batch, caller) ? [{ value: 'cancel', icon: <LuX />, label: t('orders.cancel'), danger: true, onSelect: () => { cancel.reset(); setCancelling(o); } }] : []),
  ];
  const live = list.filter((o) => o.status !== 'cancelled');
  const total = live.reduce((s, o) => add(s, parseDecSafe(o.totalBase)), ZERO);

  return (
    <Stack gap="6">
      <Stack gap="3">
        <SectionHeader title={t('orders.title')} count={list.length} mb="0" />
        {mayExternal && (
          <Text color="fg.muted" textStyle="sm">
            {t('orders.placeHint')} <RouteAnchor to={paths.placeOrders}>{t('orders.placeLink')}</RouteAnchor>
          </Text>
        )}
        <DataTable
          aria-label={t('orders.title')}
          rows={list}
          getRowId={(o) => o.id}
          selection={mayExternal ? { selected: orderSel, onChange: setOrderSel, canSelect: isAvailableOrder } : undefined}
          rowActions={list.some((o) => actionsOf(o).length > 0) ? actionsOf : undefined}
          empty={<EmptyState icon={<LuShoppingCart />} title={t('orders.empty')} description={batch.status === 'ordering' ? t('orders.emptyOrdering') : t('orders.emptyNotOrdering')} />}
          columns={[
            {
              key: 'order', header: t('orders.number'), priority: 'primary',
              cell: (o) => {
                const names = o.itemIds.map(itemName).filter((n): n is string => !!n);
                const shown = names.slice(0, 3).join(', ');
                return (
                  <Stack as="span" gap="0" textAlign="start" opacity={o.status === 'cancelled' ? 0.6 : undefined}>
                    <span>
                      <Text as="span" color="fg.muted" fontWeight="normal" fontVariantNumeric="tabular-nums" me="1.5">#{o.number}</Text>
                      {o.vendor}
                    </span>
                    <Text as="span" color="fg.muted" fontWeight="normal" textStyle="xs">
                      {t('orders.itemCount', { count: o.itemIds.length })}{shown && `: ${shown}${names.length > 3 ? '…' : ''}`}
                    </Text>
                  </Stack>
                );
              },
            },
            { key: 'status', header: t('orders.status'), cell: (o) => <OrderStatusBadge status={o.status} /> },
            { key: 'items', header: t('cost.items', { currency: base }), label: t('cost.items', { currency: base }), numeric: true, priority: 'secondary', cell: (o) => money(o.itemsCostBase) },
            { key: 'shared', header: t('cost.shared'), numeric: true, priority: 'secondary', cell: (o) => money(o.sharedCostBase) },
            { key: 'adjustments', header: t('cost.adjustments'), numeric: true, priority: 'secondary', cell: (o) => money(o.adjustmentsBase) },
            {
              key: 'total', header: t('cost.total'), numeric: true,
              cell: (o) => (
                <HStack as="span" justify="flex-end" gap="2">
                  {o.costsProvisional && o.status !== 'cancelled' && <ProvisionalBadge />}
                  <Text as="span" fontWeight="semibold">{money(o.totalBase)}</Text>
                </HStack>
              ),
            },
            {
              key: 'external', header: t('orders.external'),
              cell: (o) => (o.vendorTransactionId ? <RouteAnchor to={paths.vendorTransaction(o.vendorTransactionId)}>{t('orders.openExternal')}</RouteAnchor> : '—'),
            },
          ]}
        />
        {live.length > 0 && base && <Totals lines={[{ label: t('orders.totalActive'), value: `${format(total)} ${base}`, emphasis: true }]} />}
        <SelectionBar count={selectedOrders.length} onClear={() => setOrderSel([])}>
          <Button size="sm" onClick={() => setExternal(true)}>{t('external.create')}</Button>
        </SelectionBar>
      </Stack>

      <EditOrderModal order={editing} batchId={batch.id} items={items} onClose={() => setEditing(null)} />
      <AdjustmentModal order={adjusting} batchId={batch.id} items={items} onClose={() => setAdjusting(null)} />
      <ExternalOrderModal opened={external} orders={selectedOrders} items={items} onClose={() => { setExternal(false); setOrderSel([]); }} />
      <ReasonModal
        opened={!!cancelling}
        title={t('orders.cancel')}
        body={t('orders.cancelConfirm', { number: cancelling?.number })}
        confirmLabel={t('orders.cancel')}
        danger
        loading={cancel.isPending}
        error={cancelling ? cancel.error : null}
        onClose={() => setCancelling(null)}
        onConfirm={() => cancelling && cancel.mutate(cancelling, { onSuccess: () => setCancelling(null) })}
      />
    </Stack>
  );
}
