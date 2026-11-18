import { ClampedText } from '../../components/ClampedText';
import { safeHttpUrl } from './itemForm';
import { orderLabel } from '../labels';
import { Card, Link, Stack, Text } from '@chakra-ui/react';
import { EmptyState, type DataColumn } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuShoppingCart } from 'react-icons/lu';
import type { Batch, ItemWithLines } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { useBaseCurrency } from '../../api/meta';
import { Notice } from '../../components/ErrorAlert';
import { formatMoney } from '../money';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { FulfillmentBadge } from './StatusBadges';

type Col = DataColumn<ItemWithLines>;

/**
 * Read-only purchasing progress of the batch's approved items: fulfillment, quantities and cost.
 * Purchasers act on the Purchasing page; this tab is how everyone else follows along.
 */
export function PurchasingTab({ batch, items }: { batch: Batch; items: ItemWithLines[] }) {
  const { t, i18n } = useTranslation('batches');
  const baseCurrency = useBaseCurrency();
  const columns: Col[] = [
    { key: 'name', header: t('item.name'), priority: 'primary', cell: (i) => (
      <>
        {safeHttpUrl(i.productUrl)
          ? <Link href={safeHttpUrl(i.productUrl)} target="_blank" rel="noopener noreferrer" color="fg" textUnderlineOffset="3px"><ClampedText text={`#${i.seqNo} ${i.name}`} /></Link>
          : <ClampedText text={`#${i.seqNo} ${i.name}`} />}
        {i.unpurchasable?.reason && <Text textStyle="xs" fontWeight="normal" color="fg.muted">{t('item.unpurchasableReason', { reason: i.unpurchasable.reason })}</Text>}
      </>
    ) },
    { key: 'fulfillment', header: t('item.fulfillment'), cell: (i) => (i.fulfillment ? <FulfillmentBadge value={i.fulfillment} /> : '—') },
    { key: 'ordered', header: t('purchasingTab.ordered'), numeric: true, cell: (i) => `${i.orderedQuantity} / ${i.quantity}` },
    { key: 'received', header: t('purchasingTab.received'), numeric: true, cell: (i) => i.receivedQuantity },
    { key: 'toPurchase', header: t('purchasingTab.toPurchase'), numeric: true, cell: (i) => i.toPurchaseQuantity },
    {
      key: 'orders', header: t('purchasingTab.orders'),
      cell: (i) => (i.lines.length === 0 ? '—' : (
        <Stack gap="0">
          {i.lines.map((l) => (
            <RouteAnchor key={l.id} to={paths.vendorOrder(l.vendorOrderId)}>{`${orderLabel(l.vendorOrderNumber)} (${l.quantity})`}</RouteAnchor>
          ))}
        </Stack>
      )),
    },
    { key: 'cost', header: t('purchasingTab.cost'), numeric: true, cell: (i) => formatMoney(i.costBase, baseCurrency, i18n.language) },
  ];
  const approved = items.filter((i) => i.status === 'approved');
  if (!batch.reviewConfirmation) return <Notice>{t('purchasingTab.notConfirmed')}</Notice>;
  if (approved.length === 0) {
    return (
      <Card.Root size="sm">
        <Card.Body><EmptyState icon={<LuShoppingCart />} title={t('purchasingTab.empty')} /></Card.Body>
      </Card.Root>
    );
  }
  return (
    <Stack gap="3">
      <Text color="fg.muted" textStyle="sm">{batch.reviewConfirmation.purchaseOutside ? t('purchasingTab.outside') : t('purchasingTab.hint')}</Text>
      <Text fontWeight="medium" data-testid="batch-cost">
        {t('purchasingTab.batchCost')}:{' '}
        {batch.costIncomplete ? t('purchasingTab.costIncomplete') : formatMoney(batch.costBase, baseCurrency, i18n.language)}
      </Text>
      <DataTable
        aria-label={t('tabs.purchasing')}
        rows={approved}
        getRowId={(i) => i.id}
        columns={columns}
      />
    </Stack>
  );
}
