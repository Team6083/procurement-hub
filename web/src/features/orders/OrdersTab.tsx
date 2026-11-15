import { Button, Checkbox, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuShoppingCart } from 'react-icons/lu';
import { useMeta } from '../../api/meta';
import { useCancelOrder, useOrders } from '../../api/orders';
import type { Batch, Item, Order } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { RouteAnchor } from '../../components/RouteLinks';
import { TableShell } from '../../components/ui/table';
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
  const [orderSel, setOrderSel] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Order | null>(null);
  const [adjusting, setAdjusting] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [external, setExternal] = useState(false);

  const list = orders.data ?? [];
  const selectedOrders = list.filter((o) => orderSel[o.id] && isAvailableOrder(o));
  const mayExternal = canCreateVendorTransaction(batch, caller);
  const itemName = (id: string) => items.find((i) => i.id === id)?.name;

  if (orders.isPending) return <Skeleton h="24" rounded="l3" />;
  if (orders.error) return <ErrorAlert error={orders.error} />;

  const live = list.filter((o) => o.status !== 'cancelled');
  const total = live.reduce((s, o) => add(s, parseDecSafe(o.totalBase)), ZERO);

  return (
    <Stack gap="6">
      <Stack gap="3">
        <SectionHeader
          title={t('orders.title')}
          count={list.length}
          mb="0"
          actions={mayExternal && (
            <Button disabled={selectedOrders.length === 0} onClick={() => setExternal(true)}>
              {t('orders.createExternal', { count: selectedOrders.length })}
            </Button>
          )}
        />
        {mayExternal && (
          <Text color="fg.muted" textStyle="sm">
            {t('orders.placeHint')} <RouteAnchor to={paths.placeOrders}>{t('orders.placeLink')}</RouteAnchor>
          </Text>
        )}
        {list.length === 0 ? (
          <EmptyState icon={<LuShoppingCart />} title={t('orders.empty')} description={batch.status === 'ordering' ? t('orders.emptyOrdering') : t('orders.emptyNotOrdering')} />
        ) : (
          <TableShell minW="900px">
            <Table.Header>
              <Table.Row>
                {mayExternal && <Table.ColumnHeader w="8" />}
                <Table.ColumnHeader>{t('orders.number')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('create.vendor')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('orders.status')}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('cost.items', { currency: base })}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('cost.shared')}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('cost.adjustments')}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t('cost.total')}</Table.ColumnHeader>
                <Table.ColumnHeader>{t('orders.external')}</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {list.map((o) => {
                const names = o.itemIds.map(itemName).filter((n): n is string => !!n);
                const shown = names.slice(0, 3).join(', ');
                return (
                  <Table.Row key={o.id} opacity={o.status === 'cancelled' ? 0.6 : undefined}>
                    {mayExternal && (
                      <Table.Cell>
                        {isAvailableOrder(o) && (
                          <Checkbox.Root size="sm" checked={!!orderSel[o.id]} onCheckedChange={(e) => setOrderSel((s) => ({ ...s, [o.id]: !!e.checked }))}>
                            <Checkbox.HiddenInput aria-label={t('orders.select', { number: o.number })} />
                            <Checkbox.Control />
                          </Checkbox.Root>
                        )}
                      </Table.Cell>
                    )}
                    <Table.Cell fontVariantNumeric="tabular-nums">#{o.number}</Table.Cell>
                    <Table.Cell>
                      <Text>{o.vendor}</Text>
                      <Text color="fg.muted" textStyle="xs">
                        {t('orders.itemCount', { count: o.itemIds.length })}{shown && `: ${shown}${names.length > 3 ? '…' : ''}`}
                      </Text>
                    </Table.Cell>
                    <Table.Cell><OrderStatusBadge status={o.status} /></Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(o.itemsCostBase)}</Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(o.sharedCostBase)}</Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{money(o.adjustmentsBase)}</Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                      <HStack justify="flex-end" gap="2">
                        {o.costsProvisional && o.status !== 'cancelled' && <ProvisionalBadge />}
                        <Text as="span" fontWeight="semibold">{money(o.totalBase)}</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      {o.vendorTransactionId && <RouteAnchor to={paths.vendorTransaction(o.vendorTransactionId)}>{t('orders.openExternal')}</RouteAnchor>}
                    </Table.Cell>
                    <Table.Cell>
                      <HStack gap="2" justify="flex-end">
                        {canChangeOrder(o, batch, caller) && <Button variant="outline" onClick={() => setEditing(o)}>{t('common:actions.edit')}</Button>}
                        {canChangeOrder(o, batch, caller) && <Button variant="subtle" colorPalette="red" onClick={() => { cancel.reset(); setCancelling(o); }}>{t('orders.cancel')}</Button>}
                        {canAdjust(o, batch, caller) && <Button variant="outline" onClick={() => setAdjusting(o)}>{t('adjust.button')}</Button>}
                      </HStack>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </TableShell>
        )}
        {live.length > 0 && base && (
          <Text fontWeight="semibold">{t('orders.total', { amount: format(total), currency: base })}</Text>
        )}
      </Stack>

      <EditOrderModal order={editing} batchId={batch.id} items={items} onClose={() => setEditing(null)} />
      <AdjustmentModal order={adjusting} batchId={batch.id} items={items} onClose={() => setAdjusting(null)} />
      <ExternalOrderModal opened={external} orders={selectedOrders} items={items} onClose={() => { setExternal(false); setOrderSel({}); }} />
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
