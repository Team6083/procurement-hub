import { Badge } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { BatchStatus, Fulfillment, ItemStatus } from '../../api/types';

const BATCH_COLOR: Record<BatchStatus, string> = {
  proposed: 'yellow', proposal_rejected: 'red', draft: 'gray', collecting: 'blue', reviewing: 'purple',
  purchasing: 'cyan', receiving: 'teal', completed: 'green', cancelled: 'gray',
};
const ITEM_COLOR: Partial<Record<ItemStatus, string>> = {
  pending: 'yellow', approved: 'green', returned: 'orange', rejected: 'red', withdrawn: 'gray',
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const { t } = useTranslation('batches');
  return <Badge variant="subtle" colorPalette={BATCH_COLOR[status] ?? 'gray'}>{t(`status.${status}`, { defaultValue: status })}</Badge>;
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useTranslation('batches');
  return <Badge variant="subtle" colorPalette={ITEM_COLOR[status] ?? 'blue'}>{t(`itemStatus.${status}`, { defaultValue: status })}</Badge>;
}

const FULFILLMENT_COLOR: Record<Fulfillment, string> = {
  external: 'gray', unpurchasable: 'gray', not_ordered: 'yellow', partially_ordered: 'orange', ordered: 'blue',
  partially_received: 'teal', received: 'green', closed: 'green',
};

export function FulfillmentBadge({ value }: { value: Fulfillment }) {
  const { t } = useTranslation('batches');
  return <Badge variant="subtle" colorPalette={FULFILLMENT_COLOR[value] ?? 'gray'}>{t(`fulfillment.${value}`, { defaultValue: value })}</Badge>;
}
