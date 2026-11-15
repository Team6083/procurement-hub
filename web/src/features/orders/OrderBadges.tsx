import { Badge } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '../../api/types';
import { format, parseDecSafe } from '../batches/decimal';
import type { AmountError } from '../money';

const COLOR: Record<OrderStatus, string> = { draft: 'gray', placed: 'green', cancelled: 'red' };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation('orders');
  return <Badge variant="subtle" colorPalette={COLOR[status] ?? 'gray'}>{t(`status.${status}`, { defaultValue: status })}</Badge>;
}

export function ProvisionalBadge() {
  const { t } = useTranslation('orders');
  return <Badge variant="subtle" colorPalette="orange">{t('provisional')}</Badge>;
}

/** A decimal string for display: at least two decimals, never rounded. */
export const money = (amount: string | null | undefined) => (amount === null || amount === undefined || amount === '' ? '—' : format(parseDecSafe(amount)));

/** i18n text for an amount validation error. */
export function useAmountError() {
  const { t } = useTranslation('orders');
  return (e: AmountError | null | undefined) => (e ? t(`validation.${e}`) : undefined);
}
