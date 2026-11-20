import { Icon } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { LuCircleCheck, LuCircleDashed, LuCircleX, LuUndo2, LuBan } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { BatchStatus, Fulfillment, ItemStatus } from '../../api/types';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';
import { Tooltip } from '@team6083/ui';

const BATCH_TONE: Record<BatchStatus, StatusTone> = {
  proposed: 'attention', proposal_rejected: 'bad', draft: 'neutral', collecting: 'collecting', reviewing: 'attention',
  purchasing: 'purchasing', receiving: 'receiving', completed: 'finished', cancelled: 'neutral',
};
const ITEM_TONE: Partial<Record<ItemStatus, StatusTone>> = {
  pending: 'attention', approved: 'done', returned: 'returned', rejected: 'bad', withdrawn: 'neutral',
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

const ITEM_ICON: Record<string, { icon: IconType; color: string }> = {
  pending: { icon: LuCircleDashed, color: 'orange.fg' },
  approved: { icon: LuCircleCheck, color: 'green.fg' },
  returned: { icon: LuUndo2, color: 'yellow.fg' },
  rejected: { icon: LuCircleX, color: 'red.fg' },
  withdrawn: { icon: LuBan, color: 'fg.muted' },
};

/** The item's review status as just an icon, its name in a tooltip: once purchasing runs, the fulfillment badge is what matters. */
export function ItemStatusIcon({ status }: { status: ItemStatus }) {
  const { t } = useTranslation('batches');
  const label = t(`itemStatus.${status}`, { defaultValue: status });
  const { icon, color } = ITEM_ICON[status] ?? ITEM_ICON.pending!;
  return (
    <Tooltip content={label}>
      <Icon as={icon} color={color} boxSize="4" flexShrink={0} tabIndex={0} aria-label={label} role="img" />
    </Tooltip>
  );
}
