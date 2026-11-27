import { Card, HStack, Stack, Text } from '@chakra-ui/react';
import { Totals, TitleBar } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import type { VendorOrder } from '../../api/types';
import { IncompleteReasons } from './Incomplete';
import { Tooltip } from '@team6083/ui';
import { formatFactor, formatMoney } from '../money';
import { ProvisionalTip } from './StatusBadges';
import { StatusBadge } from '../../components/StatusBadge';

/**
 * The calculation, step by step (spec section 17.2): original total, conversion factor, target, separate payments and net,
 * with the invariant check (net equals the sum of the line totals) and the reasons an amount is missing.
 */
export function Breakdown({ order, baseCurrency, headingAs = 'h2' }: { order: VendorOrder; baseCurrency: string; headingAs?: 'h2' | 'h3' }) {
  const { t, i18n } = useTranslation('purchasing');
  const tt = order.totals;
  const c = (v: string | null | undefined) => formatMoney(v, order.currency, i18n.language);
  const b = (v: string | null | undefined) => formatMoney(v, baseCurrency, i18n.language);

  if (order.restricted) {
    return (
      <Stack gap="2">
        <TitleBar level={headingAs === 'h3' ? 4 : 2} title={t('breakdown.title')} />
        <Card.Root size="sm">
          <Card.Body gap="2">
            <Text color="fg.muted">{t('breakdown.restricted')}</Text>
            <Totals
              maxW="none"
              lines={[
                { label: t('breakdown.visibleTotal'), value: <HStack gap="2" justify="flex-end">{tt.provisional && <ProvisionalTip />}<span>{b(order.visibleTotalBase)}</span></HStack> },
                ...(order.otherTeams ? [{ label: t('breakdown.otherTeams', { count: order.otherTeams.lines }), value: b(order.otherTeams.totalBase) }] : []),
              ]}
            />
            <IncompleteReasons totals={tt} currency={order.currency} />
          </Card.Body>
        </Card.Root>
      </Stack>
    );
  }

  return (
    <Stack gap="2">
      <TitleBar level={headingAs === 'h3' ? 4 : 2} title={t('breakdown.title')} />
      <Card.Root size="sm">
        <Card.Body gap="3">
          <Totals
            maxW="none"
            lines={[
              { label: t('breakdown.lines'), value: c(tt.linesC) },
              { label: t('breakdown.shared'), value: c(tt.checkoutC) },
              { label: t('breakdown.original'), value: c(tt.originalC) },
              {
                label: t('breakdown.factor'),
                value: <HStack gap="2" justify="flex-end">{tt.provisional && <ProvisionalTip />}<Tooltip content={tt.factor ?? ''} disabled={!tt.factor}><span tabIndex={0}>{formatFactor(tt.factor)}</span></Tooltip></HStack>,
                hint: order.currency === baseCurrency ? undefined : t('breakdown.factorHint', { from: order.currency, to: baseCurrency }),
              },
              { label: t('breakdown.target', { currency: baseCurrency }), value: b(tt.targetBase) },
              { label: t('breakdown.separate'), value: b(tt.separateBase) },
              { label: t('breakdown.net'), value: b(tt.netBase), emphasis: true },
            ]}
          />
          <HStack gap="2" justify="flex-end" role="status">
            {order.invariantOk === null ? (
              <StatusBadge tone="neutral">{t('breakdown.invariantUnknown')}</StatusBadge>
            ) : order.invariantOk ? (
              <StatusBadge tone="done">{t('breakdown.invariantOk')}</StatusBadge>
            ) : (
              <StatusBadge tone="bad">{t('breakdown.invariantBroken')}</StatusBadge>
            )}
          </HStack>
          <IncompleteReasons totals={tt} currency={order.currency} />
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
