import { Badge, Button, Card, HStack, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader, SelectionBar, type DataColumn, type RowAction } from '@team6083/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuShoppingCart } from 'react-icons/lu';
import { useMe } from '../api/me';
import type { QueueGroup, QueueItem } from '../api/types';
import { useMarkUnpurchasable, useQueue } from '../api/vendorOrders';
import { DataTable } from '../components/DataTable';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { ReasonModal } from '../components/ReasonModal';
import { RouteAnchor, RouteButton } from '../components/RouteLinks';
import { AppDialog } from '../components/ui/dialog';
import { formatMoney } from '../features/orders/money';
import { SendToOrderModal } from '../features/orders/SendToOrderModal';
import { VendorOrderView } from '../features/orders/VendorOrderView';
import { lineTotal } from '../features/batches/estimates';
import { format } from '../features/batches/decimal';
import { paths } from '../paths';

const groupKey = (i: QueueItem) => i.vendorId ?? '';

/**
 * The purchasing overview: approved items still to buy, across teams and grouped by vendor. Pick items of one vendor,
 * create or extend a draft order, then fill the unit prices and place it in the dialog that opens, without leaving the page.
 */
export function PurchasingPage() {
  const { t, i18n } = useTranslation('purchasing');
  const { me } = useMe();
  const queue = useQueue();
  const unbuy = useMarkUnpurchasable();
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [marking, setMarking] = useState<QueueItem | null>(null);

  const groups = useMemo(() => queue.data ?? [], [queue.data]);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const groupOf = (key: string): QueueGroup | undefined => groups.find((g) => (g.vendorId ?? '') === key);
  const selected = items.filter((i) => picked.includes(i.id));
  const keys = new Set(selected.map(groupKey));
  const oneVendor = keys.size === 1;
  const selectedGroup = oneVendor ? groupOf([...keys][0] ?? '') : undefined;

  const columns: DataColumn<QueueItem>[] = [
    {
      key: 'name', header: t('queue.item'), priority: 'primary',
      cell: (i) => <Stack gap="0"><span>{`#${i.seqNo} ${i.name}`}</span>{i.sku && <Text fontSize="xs" color="fg.muted">{i.sku}</Text>}</Stack>,
    },
    { key: 'team', header: t('line.team'), priority: 'secondary', cell: (i) => i.teamName },
    { key: 'batch', header: t('queue.batch'), priority: 'secondary', cell: (i) => <RouteAnchor to={paths.batch(i.batchId)}>{`#${i.batchNumber} ${i.batchTitle}`}</RouteAnchor> },
    { key: 'remaining', header: t('queue.remaining'), numeric: true, cell: (i) => <Text fontWeight="semibold">{i.toPurchaseQuantity}</Text> },
    { key: 'requested', header: t('queue.requested'), numeric: true, cell: (i) => i.quantity },
    {
      key: 'planned', header: t('queue.inOrders'), numeric: true,
      cell: (i) => (i.plannedQuantity > 0 ? t('queue.inOrdersValue', { draft: i.draftQuantity, placed: i.orderedQuantity }) : '—'),
    },
    {
      key: 'estimate', header: t('queue.estimate'), numeric: true,
      cell: (i) => formatMoney(format(lineTotal({ quantity: i.toPurchaseQuantity, estimatedUnitPrice: i.estimatedUnitPrice })), i.estimatedUnitPrice.currency, i18n.language),
    },
  ];
  const rowActions = (i: QueueItem): RowAction[] => [{
    value: 'unbuy', icon: <LuBan />, danger: true,
    label: i.orderedQuantity > 0 || i.plannedQuantity > 0 ? t('queue.skipRemaining') : t('queue.unpurchasable'),
    onSelect: () => { unbuy.reset(); setMarking(i); },
  }];

  return (
    <Stack gap="4">
      <PageHeader
        mb="0" title={t('queue.title')} description={t('queue.intro')}
        actions={<RouteButton size="sm" variant="outline" to="/vendor-orders">{t('list.title')}</RouteButton>}
      />
      {!me?.isPurchaser && <Notice>{t('queue.purchasersOnly')}</Notice>}
      {queue.isPending && <Skeleton h="24" rounded="l3" />}
      {queue.error && <ErrorAlert error={queue.error} />}
      {queue.data && (
        <DataTable
          aria-label={t('queue.title')} rows={items} columns={columns} getRowId={(i) => i.id}
          groupBy={groupKey}
          groupLabel={(key) => {
            const g = groupOf(key);
            return (
              <HStack gap="2" wrap="wrap">
                <Text fontWeight="semibold">{g?.vendorName || t('queue.other')}</Text>
                <Badge variant="subtle">{t('queue.itemCount', { count: g?.items.length ?? 0 })}</Badge>
                {(g?.teamIds.length ?? 0) > 1 && <Badge colorPalette="orange" variant="subtle">{t('queue.mergeBadge', { count: g?.teamIds.length })}</Badge>}
              </HStack>
            );
          }}
          selection={me?.isPurchaser ? { selected: picked, onChange: setPicked } : undefined}
          rowActions={me?.isPurchaser ? rowActions : undefined}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuShoppingCart />} title={t('queue.empty')} description={t('queue.emptyHint')} /></Card.Body></Card.Root>}
        />
      )}
      <ErrorAlert error={unbuy.error && !marking ? unbuy.error : null} />
      <SelectionBar count={selected.length} onClear={() => setPicked([])}>
        {!oneVendor && <Text textStyle="sm" color="fg.muted">{t('queue.oneVendor')}</Text>}
        <Button size="sm" disabled={!oneVendor} onClick={() => setSending(true)}>{t('queue.sendToOrder')}</Button>
      </SelectionBar>
      {sending && (
        <SendToOrderModal
          opened items={selected} vendorId={selectedGroup?.vendorId ?? ''} otherTeamCount={selectedGroup?.teamIds.length ?? 0}
          onClose={() => setSending(false)}
          onDone={(id) => { setSending(false); setPicked([]); setOpened(id); }}
        />
      )}
      <AppDialog open={!!opened} onClose={() => setOpened(null)} size="xl" title={t('queue.orderDialog')}>
        {opened && <VendorOrderView id={opened} embedded />}
      </AppDialog>
      <ReasonModal
        opened={!!marking} danger title={marking && marking.plannedQuantity > 0 ? t('queue.skipRemaining') : t('queue.unpurchasable')}
        body={marking && t('queue.unpurchasableHelp', { name: marking.name })} reasonLabel={t('queue.reason')} confirmLabel={t('queue.unpurchasable')}
        loading={unbuy.isPending} error={unbuy.error} onClose={() => setMarking(null)}
        onConfirm={(reason) => marking && unbuy.mutate({ item: marking, reason }, { onSuccess: () => setMarking(null) })}
      />
    </Stack>
  );
}
