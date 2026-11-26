import { Alert, List } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { OrderTotals } from '../../api/types';

/** Why an order's amounts cannot be computed, listed next to the amounts (spec section 11). */
export function IncompleteReasons({ totals, currency }: { totals: OrderTotals; currency: string }) {
  const { t } = useTranslation('purchasing');
  if (totals.incomplete.length === 0) return null;
  return (
    <Alert.Root status="warning" size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t('incomplete.title')}</Alert.Title>
        <List.Root textStyle="sm" ps="4">
          {totals.incomplete.map((r, i) => (
            <List.Item key={`${r.code}:${r.lineNo ?? ''}:${i}`}>{t(`incomplete.${r.code}`, { line: r.lineNo, entry: r.entryNo, currency: r.currency ?? currency })}</List.Item>
          ))}
        </List.Root>
      </Alert.Content>
    </Alert.Root>
  );
}
