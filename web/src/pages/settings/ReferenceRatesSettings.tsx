import { Button, Flex, Heading, HStack, Input, Spinner, Stack, Text } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useTeamMutation } from '../../api/teams';
import type { Team } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
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
      <fieldset disabled={team.archived} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Stack maxW="560px" gap="3">
          <Text fontSize="sm" color="fg.muted">{t('rates.help', { base })}</Text>
          {fields.length === 0 && <Text color="fg.muted">{t('rates.none')}</Text>}
          {fields.map((f, i) => (
            <Flex key={f.id} align="flex-start" gap="2">
              <Controller
                control={form.control}
                name={`rates.${i}.currency`}
                render={({ field }) => (
                  <SelectField
                    aria-label={t('rates.currency')}
                    w="110px"
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    options={currencies}
                    errorText={msg(err.rates?.[i]?.currency?.message)}
                  />
                )}
              />
              <FormField flex="1" errorText={msg(err.rates?.[i]?.rateToBase?.message)}>
                <Input size="sm" aria-label={t('rates.rate', { base })} placeholder={t('rates.rate', { base })} inputMode="decimal" {...form.register(`rates.${i}.rateToBase`)} />
              </FormField>
              <Button size="sm" variant="outline" onClick={() => remove(i)}>{t('rates.remove')}</Button>
            </Flex>
          ))}
          <HStack>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => append({ currency: currencies.find((c) => !form.getValues('rates').some((r) => r.currency === c)) ?? currencies[0] ?? '', rateToBase: '' })}
              disabled={currencies.length === 0}
            >
              {t('rates.add')}
            </Button>
          </HStack>
          <ErrorAlert error={save.error} />
          {save.isSuccess && !form.formState.isDirty && <Text fontSize="sm" color="fg.success">{t('common:actions.saved')}</Text>}
          <HStack>
            <Button type="submit" loading={save.isPending}>{t('common:actions.save')}</Button>
          </HStack>
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
  if (meta.isPending) return <Spinner />;
  if (meta.error || !meta.data) return <ErrorAlert error={meta.error} />;
  const currencies = selectableCurrencies(meta.data.supportedCurrencies, meta.data.baseCurrency);
  return (
    <Stack gap="4">
      <Heading as="h3" size="lg">{t('settings.nav.rates')}</Heading>
      {currencies.length === 0 && <Notice>{t('rates.noCurrencies')}</Notice>}
      <RatesForm_ key={full.version} team={full} currencies={currencies} base={meta.data.baseCurrency} />
    </Stack>
  );
}
