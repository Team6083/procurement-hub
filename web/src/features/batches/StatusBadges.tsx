import { useTranslation } from 'react-i18next';
import type { BatchStatus, Fulfillment, ItemStatus } from '../../api/types';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';

const BATCH_TONE: Record<BatchStatus, StatusTone> = {
  proposed: 'attention', proposal_rejected: 'bad', draft: 'neutral', collecting: 'active', reviewing: 'attention',
  purchasing: 'active', receiving: 'active', completed: 'finished', cancelled: 'neutral',
};
const ITEM_TONE: Partial<Record<ItemStatus, StatusTone>> = {
  pending: 'attention', approved: 'done', returned: 'attention', rejected: 'bad', withdrawn: 'neutral',
};
const FULFILLMENT_TONE: Record<Fulfillment, StatusTone> = {
  external: 'neutral', unpurchasable: 'neutral', not_ordered: 'attention', partially_ordered: 'active', ordered: 'active',
  partially_received: 'active', received: 'done', closed: 'finished',
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const { t } = useTranslation('batches');
  return <StatusBadge tone={BATCH_TONE[status] ?? 'neutral'}>{t(`status.${status}`, { defaultValue: status })}</StatusBadge>;
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useTranslation('batches');
  return <StatusBadge tone={ITEM_TONE[status] ?? 'active'}>{t(`itemStatus.${status}`, { defaultValue: status })}</StatusBadge>;
}

export function FulfillmentBadge({ value }: { value: Fulfillment }) {
  const { t } = useTranslation('batches');
  return <StatusBadge tone={FULFILLMENT_TONE[value] ?? 'neutral'}>{t(`fulfillment.${value}`, { defaultValue: value })}</StatusBadge>;
}
