import { HStack, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import type { Item, ReferenceRate } from '../../api/types';
import { estimate } from './estimates';

/** Per-currency totals, base-currency estimate, and a separate "no rate" bucket (spec §11). */
export function EstimateSummary({ items, rates, label }: { items: Item[]; rates: Pick<ReferenceRate, 'currency' | 'rateToBase'>[]; label?: string }) {
  const { t } = useTranslation('batches');
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const e = estimate(items, rates, base);
  return (
    <Stack gap="0.5">
      {label && <Text fontSize="sm" fontWeight="semibold">{label}</Text>}
      {e.byCurrency.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">{t('totals.none')}</Text>
      ) : (
        <>
          <HStack gap="4" wrap="wrap">
            {e.byCurrency.map((c) => <Text key={c.currency} fontSize="sm">{c.amount} {c.currency}</Text>)}
          </HStack>
          <Text fontSize="sm" fontWeight="semibold">{t('totals.base', { amount: e.base, currency: base })}</Text>
          {e.noRate.length > 0 && (
            <Text fontSize="sm" color="fg.warning">
              {t('totals.noRate')}: {e.noRate.map((c) => `${c.amount} ${c.currency}`).join(', ')}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
