import { Badge } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { LineStatus, OrderStatus } from '../../api/types';

const ORDER_COLOR: Record<OrderStatus, string> = { draft: 'gray', placed: 'blue', cancelled: 'red' };
const LINE_COLOR: Record<LineStatus, string> = {
  cancelled: 'red', draft: 'gray', short_accepted: 'orange', not_obtained: 'orange', received: 'green', partially_received: 'teal', ordered: 'blue',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation('purchasing');
  return <Badge variant="subtle" colorPalette={ORDER_COLOR[status]}>{t(`orderStatus.${status}`)}</Badge>;
}

export function LineStatusBadge({ status }: { status: LineStatus }) {
  const { t } = useTranslation('purchasing');
  return <Badge variant="subtle" colorPalette={LINE_COLOR[status] ?? 'gray'}>{t(`lineStatus.${status}`, { defaultValue: status })}</Badge>;
}

/** Amounts that are not final (computed from a reference rate, spec section 11). */
export function ProvisionalBadge() {
  const { t } = useTranslation('purchasing');
  return <Badge variant="outline" colorPalette="orange">{t('provisional')}</Badge>;
}
