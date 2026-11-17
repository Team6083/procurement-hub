import { List, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { OrderTotals } from '../../api/types';

/** Why an order's amounts cannot be computed, listed next to the amounts (spec section 11). */
export function IncompleteReasons({ totals, currency }: { totals: OrderTotals; currency: string }) {
  const { t } = useTranslation('purchasing');
  if (totals.incomplete.length === 0) return null;
  return (
    <div>
      <Text textStyle="sm" fontWeight="medium" color="fg.warning">{t('incomplete.title')}</Text>
      <List.Root textStyle="sm" ps="4">
        {totals.incomplete.map((r, i) => (
          <List.Item key={`${r.code}:${r.lineNo ?? ''}:${i}`}>{t(`incomplete.${r.code}`, { line: r.lineNo, currency })}</List.Item>
        ))}
      </List.Root>
    </div>
  );
}
