import { Badge } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { BatchStatus, ItemStatus } from '../../api/types';

const BATCH_COLOR: Record<BatchStatus, string> = {
  proposed: 'yellow', proposal_rejected: 'red', draft: 'gray', collecting: 'blue', reviewing: 'grape',
  ordering: 'cyan', receiving: 'teal', completed: 'green', cancelled: 'gray',
};
const ITEM_COLOR: Partial<Record<ItemStatus, string>> = {
  pending: 'yellow', approved: 'green', returned: 'orange', rejected: 'red', withdrawn: 'gray',
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const { t } = useTranslation('batches');
  return <Badge color={BATCH_COLOR[status] ?? 'gray'}>{t(`status.${status}`, { defaultValue: status })}</Badge>;
}

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useTranslation('batches');
  return <Badge variant="light" color={ITEM_COLOR[status] ?? 'blue'}>{t(`itemStatus.${status}`, { defaultValue: status })}</Badge>;
}
