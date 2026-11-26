import { Badge, Card, HStack, Stack, Text } from '@chakra-ui/react';
import { Totals, TitleBar } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import type { VendorOrder } from '../../api/types';
import { IncompleteReasons } from './Incomplete';
import { Tooltip } from '@team6083/ui';
import { formatFactor, formatMoney } from '../money';
import { ProvisionalBadge } from './StatusBadges';

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
        <TitleBar level={headingAs === 'h3' ? 3 : 2} title={t('breakdown.title')} />
        <Card.Root size="sm">
          <Card.Body gap="2">
            <Text color="fg.muted">{t('breakdown.restricted')}</Text>
            <HStack gap="2"><Text fontWeight="medium">{t('breakdown.visibleTotal')}</Text><Text>{b(order.visibleTotalBase)}</Text>{tt.provisional && <ProvisionalBadge />}</HStack>
            {order.otherTeams && (
              <Text textStyle="sm">{t('breakdown.otherTeams', { count: order.otherTeams.lines })}: {b(order.otherTeams.totalBase)}</Text>
            )}
            <IncompleteReasons totals={tt} currency={order.currency} />
          </Card.Body>
        </Card.Root>
      </Stack>
    );
  }

  return (
    <Stack gap="2">
      <TitleBar level={headingAs === 'h3' ? 3 : 2} title={t('breakdown.title')} />
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
                value: <HStack gap="2" justify="flex-end">{tt.provisional && <ProvisionalBadge />}<Tooltip content={tt.factor ?? ''} disabled={!tt.factor}><span tabIndex={0}>{formatFactor(tt.factor)}</span></Tooltip></HStack>,
                hint: order.currency === baseCurrency ? undefined : t('breakdown.factorHint', { from: order.currency, to: baseCurrency }),
              },
              { label: t('breakdown.target', { currency: baseCurrency }), value: b(tt.targetBase) },
              { label: t('breakdown.separate'), value: b(tt.separateBase) },
              { label: t('breakdown.net'), value: b(tt.netBase), emphasis: true },
            ]}
          />
          <HStack gap="2" justify="flex-end" role="status">
            {order.invariantOk === null ? (
              <Badge variant="outline">{t('breakdown.invariantUnknown')}</Badge>
            ) : order.invariantOk ? (
              <Badge colorPalette="green" variant="subtle">{t('breakdown.invariantOk')}</Badge>
            ) : (
              <Badge colorPalette="red" variant="solid">{t('breakdown.invariantBroken')}</Badge>
            )}
          </HStack>
          <IncompleteReasons totals={tt} currency={order.currency} />
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
