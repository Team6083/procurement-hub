import { Button, Card, HStack, Input, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCoins } from 'react-icons/lu';
import { useMe } from '../api/me';
import { useMeta } from '../api/meta';
import { useDeleteRate, usePutRate, useReferenceRates } from '../api/vendors';
import type { ReferenceRate } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { FormField } from '../components/ui/field';
import { MAX_RATE_DIGITS, validateAmount } from '../features/money';
import { shortDate } from '../features/dates';

function RateRow({ currency, rate, base, canEdit }: { currency: string; rate: ReferenceRate | undefined; base: string; canEdit: boolean }) {
  const { t } = useTranslation('admin');
  const put = usePutRate();
  const del = useDeleteRate();
  const [value, setValue] = useState(rate?.rateToBase ?? '');
  const invalid = value.trim() !== '' && validateAmount(value.trim(), { digits: MAX_RATE_DIGITS, nonZero: true }) !== null;
  return (
    <Card.Root size="sm">
      <Card.Body gap="2">
        <HStack justify="space-between" wrap="wrap" gap="3">
          <Text fontWeight="medium">{currency}</Text>
          {canEdit ? (
            <HStack gap="2" flex="1" justify="flex-end" wrap="wrap">
              <FormField flex="1" errorText={invalid ? t('rates.invalid') : undefined}>
                <Input size="sm" aria-label={t('rates.rate', { currency, base })} value={value} inputMode="decimal"
                  onChange={(e) => setValue(e.currentTarget.value)} />
              </FormField>
              <Button size="sm" loading={put.isPending} disabled={!value.trim() || invalid || value.trim() === rate?.rateToBase}
                onClick={() => put.mutate({ currency, rateToBase: value.trim(), existing: rate })}>
                {t('common:actions.save')}
              </Button>
              {rate && <Button size="sm" variant="outline" colorPalette="red" loading={del.isPending} onClick={() => del.mutate(rate)}>{t('common:actions.delete')}</Button>}
            </HStack>
          ) : (
            <Text fontVariantNumeric="tabular-nums">{rate ? `1 ${currency} = ${rate.rateToBase} ${base}` : t('rates.none')}</Text>
          )}
        </HStack>
        {rate && <Text textStyle="xs" color="fg.muted">{t('rates.updated', { date: shortDate(rate.updatedAt) })}</Text>}
        <ErrorAlert error={put.error ?? del.error} />
      </Card.Body>
    </Card.Root>
  );
}

/** Global reference rates: system admins edit them, everyone else reads them. */
export function ReferenceRatesPage() {
  const { t } = useTranslation('admin');
  const { isSystemAdmin } = useMe();
  const meta = useMeta();
  const rates = useReferenceRates();
  const base = meta.data?.baseCurrency ?? '';
  const currencies = (meta.data?.supportedCurrencies ?? []).filter((c) => c !== base);
  return (
    <Stack gap="4">
      <PageHeader mb="0" title={t('rates.title')} description={t('rates.intro', { base })} />
      {rates.isPending && <Skeleton h="24" rounded="l3" />}
      {rates.error && <ErrorAlert error={rates.error} />}
      {rates.data && currencies.length === 0 && (
        <Card.Root size="sm"><Card.Body><EmptyState icon={<LuCoins />} title={t('rates.noCurrencies')} /></Card.Body></Card.Root>
      )}
      {rates.data && currencies.map((c) => (
        <RateRow key={`${c}:${rates.data.find((r) => r.currency === c)?.version ?? 0}`} currency={c}
          rate={rates.data.find((r) => r.currency === c)} base={base} canEdit={isSystemAdmin} />
      ))}
    </Stack>
  );
}
