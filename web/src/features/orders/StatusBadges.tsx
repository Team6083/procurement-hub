import { IconButton } from '@chakra-ui/react';
import { ToggleTip } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuClock } from 'react-icons/lu';
import type { AccountingState, LineStatus, OrderStatus, ReceivingState } from '../../api/types';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';

const ORDER_TONE: Record<OrderStatus, StatusTone> = { draft: 'neutral', placed: 'active', cancelled: 'neutral' };
const LINE_TONE: Record<LineStatus, StatusTone> = {
  cancelled: 'neutral', draft: 'neutral', short_accepted: 'finished', not_obtained: 'finished', received: 'done', partially_received: 'active', ordered: 'active',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation('purchasing');
  return <StatusBadge tone={ORDER_TONE[status]}>{t(`orderStatus.${status}`)}</StatusBadge>;
}

export function LineStatusBadge({ status }: { status: LineStatus }) {
  const { t } = useTranslation('purchasing');
  return <StatusBadge tone={LINE_TONE[status] ?? 'neutral'}>{t(`lineStatus.${status}`, { defaultValue: status })}</StatusBadge>;
}

/** Amounts that are not final (computed from a reference rate, spec section 11): a small icon, the reason opens on click. */
export function ProvisionalTip() {
  const { t } = useTranslation('purchasing');
  return (
    <ToggleTip content={t('provisionalHint')}>
      <IconButton variant="ghost" size="2xs" colorPalette="orange" aria-label={t('provisional')}>
        <LuClock />
      </IconButton>
    </ToggleTip>
  );
}

const RECEIVING_TONE: Record<ReceivingState, StatusTone> = { none: 'neutral', partial: 'active', closed: 'done' };
const ACCOUNTING_TONE: Record<AccountingState, StatusTone> = { incomplete: 'attention', provisional: 'active', final: 'done' };

/** Receiving and accounting progress of a placed order (spec 10.3); nothing for drafts and cancelled orders. */
export function OrderProgressBadges({ order }: { order: { receivingState: ReceivingState | null; accountingState: AccountingState | null } }) {
  const { t } = useTranslation('purchasing');
  if (!order.receivingState || !order.accountingState) return null;
  return (
    <>
      <StatusBadge tone={RECEIVING_TONE[order.receivingState]}>{t(`progress.receivingState.${order.receivingState}`)}</StatusBadge>
      <StatusBadge tone={ACCOUNTING_TONE[order.accountingState]}>{t(`progress.accountingState.${order.accountingState}`)}</StatusBadge>
    </>
  );
}
