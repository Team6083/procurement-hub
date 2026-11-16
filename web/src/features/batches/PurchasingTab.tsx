import { Card, Stack, Text } from '@chakra-ui/react';
import { EmptyState, type DataColumn } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuShoppingCart } from 'react-icons/lu';
import type { Batch, Item } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { Notice } from '../../components/ErrorAlert';
import { FulfillmentBadge } from './StatusBadges';

type Col = DataColumn<Item>;

/**
 * Read-only purchasing progress of the batch's approved items: fulfillment, quantities and cost.
 * Purchasers act on the Purchasing page; this tab is how everyone else follows along.
 */
export function PurchasingTab({ batch, items }: { batch: Batch; items: Item[] }) {
  const { t } = useTranslation('batches');
  const columns: Col[] = [
    { key: 'name', header: t('item.name'), priority: 'primary', cell: (i) => `#${i.seqNo} ${i.name}` },
    { key: 'fulfillment', header: t('item.fulfillment'), cell: (i) => (i.fulfillment ? <FulfillmentBadge value={i.fulfillment} /> : '—') },
    { key: 'ordered', header: t('purchasingTab.ordered'), numeric: true, cell: (i) => `${i.orderedQuantity} / ${i.quantity}` },
    { key: 'received', header: t('purchasingTab.received'), numeric: true, cell: (i) => i.receivedQuantity },
    { key: 'toPurchase', header: t('purchasingTab.toPurchase'), numeric: true, cell: (i) => i.toPurchaseQuantity },
    { key: 'cost', header: t('purchasingTab.cost'), numeric: true, cell: (i) => i.costBase ?? '—' },
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
      <DataTable
        aria-label={t('tabs.purchasing')}
        rows={approved}
        getRowId={(i) => i.id}
        columns={columns}
      />
    </Stack>
  );
}
