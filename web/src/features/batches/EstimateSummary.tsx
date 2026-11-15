import { Text } from '@chakra-ui/react';
import { Totals, type TotalsLine } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import type { Item, ReferenceRate } from '../../api/types';
import { estimate } from './estimates';

/** Per-currency totals, base-currency estimate, and a separate "no rate" bucket (spec §11), as Totals under the table. */
export function EstimateSummary({ items, rates, hint }: { items: Item[]; rates: Pick<ReferenceRate, 'currency' | 'rateToBase'>[]; hint?: string }) {
  const { t } = useTranslation('batches');
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const e = estimate(items, rates, base);
  if (e.byCurrency.length === 0) return <Text textStyle="sm" color="fg.muted" textAlign="end">{t('totals.none')}</Text>;
  const noRate = new Set(e.noRate.map((c) => c.currency));
  // One currency that is the base currency: the estimate line says it all.
  const perCurrency = e.byCurrency.length === 1 && e.byCurrency[0]!.currency === base ? [] : e.byCurrency;
  const lines: TotalsLine[] = [
    ...perCurrency.map((c) => ({
      label: t('totals.inCurrency', { currency: c.currency }),
      value: `${c.amount} ${c.currency}`,
      hint: noRate.has(c.currency) ? t('totals.noRateHint') : undefined,
    })),
    { label: t('totals.estimate', { currency: base }), value: `${e.base} ${base}`, emphasis: true, hint },
  ];
  return <Totals lines={lines} />;
}

/** The base-currency estimate of some items as one short text, e.g. for the selection bar. */
export function useEstimateText(items: Item[], rates: Pick<ReferenceRate, 'currency' | 'rateToBase'>[]): string {
  const { t } = useTranslation('batches');
  const base = useMeta().data?.baseCurrency ?? '';
  const e = estimate(items, rates, base);
  return t('totals.selectedEstimate', { amount: e.base, currency: base }) + (e.noRate.length ? ` + ${e.noRate.map((c) => `${c.amount} ${c.currency}`).join(', ')}` : '');
}
