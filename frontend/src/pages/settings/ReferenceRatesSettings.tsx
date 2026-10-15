import { Alert, Button, Group, Loader, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useTeamMutation } from '../../api/teams';
import type { Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useTeamCtx } from '../../features/teams/TeamContext';
import { selectableCurrencies } from '../../features/teams/rates';
import { ratesSchema, type RatesForm } from '../../features/teams/schemas';

function RatesForm_({ team, currencies, base }: { team: Team; currencies: string[]; base: string }) {
  const { t } = useTranslation('teams');
  const form = useForm<RatesForm>({
    resolver: zodResolver(ratesSchema),
    defaultValues: { rates: team.referenceRates.map((r) => ({ currency: r.currency, rateToBase: r.rateToBase })) },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rates' });
  const save = useTeamMutation<RatesForm>(team.id, (api, headers, body) =>
    api.full.put<Team>(`/teams/${team.id}/reference-rates`, { rates: body.rates.map((r) => ({ currency: r.currency, rateToBase: r.rateToBase.trim() })) }, { headers }),
  );
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <fieldset disabled={team.archived} style={{ border: 0, padding: 0, margin: 0 }}>
        <Stack maw={560}>
          <Text size="sm" c="dimmed">{t('rates.help', { base })}</Text>
          {fields.length === 0 && <Text c="dimmed">{t('rates.none')}</Text>}
          {fields.map((f, i) => (
            <Group key={f.id} align="flex-start" wrap="nowrap">
              <Controller
                control={form.control}
                name={`rates.${i}.currency`}
                render={({ field }) => (
                  <Select
                    aria-label={t('rates.currency')}
                    w={120}
                    allowDeselect={false}
                    data={currencies}
                    error={msg(err.rates?.[i]?.currency?.message)}
                    {...field}
                  />
                )}
              />
              <TextInput
                style={{ flex: 1 }}
                aria-label={t('rates.rate', { base })}
                placeholder={t('rates.rate', { base })}
                inputMode="decimal"
                error={msg(err.rates?.[i]?.rateToBase?.message)}
                {...form.register(`rates.${i}.rateToBase`)}
              />
              <Button variant="default" onClick={() => remove(i)}>{t('rates.remove')}</Button>
            </Group>
          ))}
          <Group>
            <Button
              variant="light"
              onClick={() => append({ currency: currencies.find((c) => !form.getValues('rates').some((r) => r.currency === c)) ?? currencies[0] ?? '', rateToBase: '' })}
              disabled={currencies.length === 0}
            >
              {t('rates.add')}
            </Button>
          </Group>
          <ErrorAlert error={save.error} />
          {save.isSuccess && !form.formState.isDirty && <Text size="sm" c="green">{t('common:actions.saved')}</Text>}
          <Group>
            <Button type="submit" loading={save.isPending}>{t('common:actions.save')}</Button>
          </Group>
        </Stack>
      </fieldset>
    </form>
  );
}

export function ReferenceRatesSettings() {
  const { t } = useTranslation('teams');
  const { full } = useTeamCtx();
  const meta = useMeta();
  if (!full) return null;
  if (meta.isPending) return <Loader />;
  if (meta.error || !meta.data) return <ErrorAlert error={meta.error} />;
  const currencies = selectableCurrencies(meta.data.supportedCurrencies, meta.data.baseCurrency);
  return (
    <Stack>
      <Title order={3}>{t('settings.nav.rates')}</Title>
      {currencies.length === 0 && <Alert color="gray">{t('rates.noCurrencies')}</Alert>}
      <RatesForm_ key={full.version} team={full} currencies={currencies} base={meta.data.baseCurrency} />
    </Stack>
  );
}
