import { Badge, Button, Dialog, HStack, Link, Stack, Text } from '@chakra-ui/react';
import { DataTable, EmptyState, SelectionBar, type DataColumn, type RowAction } from '@team6083/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuShoppingCart } from 'react-icons/lu';
import type { QueueGroup, QueueItem } from '../api/types';
import { useItemAction } from '../api/batches';
import { useQueue } from '../api/vendorOrders';
import { ErrorAlert } from '../components/ErrorAlert';
import { ListSkeleton } from '../components/PageStates';
import { ReasonModal } from '../components/ReasonModal';
import { RouteAnchor } from '../components/RouteLinks';
import { AppDialog } from '../components/ui/dialog';
import { formatMoney } from '../features/money';
import { SendToOrderModal } from '../features/orders/SendToOrderModal';
import { VendorOrderView } from '../features/orders/VendorOrderView';
import { lineTotal } from '../features/batches/estimates';
import { safeHttpUrl } from '../features/batches/itemForm';
import { format } from '../features/batches/decimal';
import { paths } from '../paths';
import { StatusBadge } from '../components/StatusBadge';

/** Whether skipping the item stops buying what is left (something is already planned or ordered) rather than marking it unpurchasable. */
const skipsRemaining = (i: QueueItem) => i.orderedQuantity > 0 || i.plannedQuantity > 0;
const groupKey = (i: QueueItem) => i.vendorId ?? '';

/**
 * The purchasing overview: approved items still to buy, across teams and grouped by vendor. Pick items of one vendor,
 * create or extend a draft order, then fill the unit prices and place it in the dialog that opens, without leaving the page.
 */
export function PurchasingPage() {
  const { t, i18n } = useTranslation('purchasing');
  // The route lets only purchasers in (RoleGuard), so the queue request never ends in a 403.
  const queue = useQueue();
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [marking, setMarking] = useState<QueueItem | null>(null);
  const unbuy = useItemAction();

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
      cell: (i) => (
        <Stack gap="0">
          <span>
            {safeHttpUrl(i.productUrl)
              ? <Link href={safeHttpUrl(i.productUrl)} target="_blank" rel="noopener noreferrer" color="fg" textUnderlineOffset="3px">{`#${i.seqNo} ${i.name}`}</Link>
              : `#${i.seqNo} ${i.name}`}
          </span>
          {i.sku && <Text textStyle="xs" color="fg.muted">{i.sku}</Text>}
          {/* Items grouped under "other" keep the vendor their requester typed. */}
          {!i.vendorId && i.vendorName && <Text textStyle="xs" color="fg.muted">{i.vendorName}</Text>}
        </Stack>
      ),
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
    label: skipsRemaining(i) ? t('queue.skipRemaining') : t('queue.unpurchasable'),
    onSelect: () => { unbuy.reset(); setMarking(i); },
  }];

  return (
    <Stack gap="4">
      {queue.isPending && <ListSkeleton rows={6} />}
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
                {(g?.teamIds.length ?? 0) > 1 && <StatusBadge tone="attention">{t('queue.mergeBadge', { count: g?.teamIds.length })}</StatusBadge>}
              </HStack>
            );
          }}
          selection={{ selected: picked, onChange: setPicked }}
          rowActions={rowActions}
          empty={<EmptyState icon={<LuShoppingCart />} title={t('queue.empty')} description={t('queue.emptyHint')} />}
        />
      )}
      <SelectionBar count={selected.length} onClear={() => setPicked([])}>
        {!oneVendor && <Text textStyle="sm" color="fg.muted">{t('queue.oneVendor')}</Text>}
        <Button size="sm" disabled={!oneVendor} onClick={() => setSending(true)}>{t('queue.sendToOrder')}</Button>
      </SelectionBar>
      {sending && (
        <SendToOrderModal
          open items={selected} vendorId={selectedGroup?.vendorId ?? ''} otherTeamCount={selectedGroup?.teamIds.length ?? 0}
          onClose={() => setSending(false)}
          onDone={(id) => { setSending(false); setPicked([]); setViewing(id); }}
        />
      )}
      <AppDialog open={!!viewing} onClose={() => setViewing(null)} size="xl" title={t('queue.orderDialog')}>
        <Dialog.Body>{viewing && <VendorOrderView id={viewing} embedded />}</Dialog.Body>
      </AppDialog>
      <ReasonModal
        open={!!marking} danger title={marking && skipsRemaining(marking) ? t('queue.skipRemaining') : t('queue.unpurchasable')}
        body={marking && t('queue.unpurchasableHelp', { name: marking.name })} reasonLabel={t('queue.reason')} confirmLabel={marking && skipsRemaining(marking) ? t('queue.skipRemaining') : t('queue.unpurchasable')}
        loading={unbuy.isPending} error={unbuy.error} onClose={() => setMarking(null)}
        onConfirm={(reason) => marking && unbuy.mutate({ item: marking, action: 'unpurchasable', reason }, { onSuccess: () => setMarking(null) })}
      />
    </Stack>
  );
}
