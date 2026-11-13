import { Group, Stack, Text } from '@mantine/core';
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
    <Stack gap={2}>
      {label && <Text size="sm" fw={600}>{label}</Text>}
      {e.byCurrency.length === 0 ? (
        <Text size="sm" c="dimmed">{t('totals.none')}</Text>
      ) : (
        <>
          <Group gap="md">
            {e.byCurrency.map((c) => <Text key={c.currency} size="sm">{c.amount} {c.currency}</Text>)}
          </Group>
          <Text size="sm" fw={600}>{t('totals.base', { amount: e.base, currency: base })}</Text>
          {e.noRate.length > 0 && (
            <Text size="sm" c="orange">
              {t('totals.noRate')}: {e.noRate.map((c) => `${c.amount} ${c.currency}`).join(', ')}
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}
