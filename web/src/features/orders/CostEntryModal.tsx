import { Alert, Box, Button, Checkbox, CheckboxGroup, Dialog, Fieldset, Input, SimpleGrid, Stack, Text, Textarea } from '@chakra-ui/react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useBaseCurrency, useMeta } from '../../api/meta';
import type { CostEntry, VendorOrder } from '../../api/types';
import { useCreateCostEntry, usePutCostEntry } from '../../api/vendorOrders';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import {
  bodyOf, effective, emptyValues, entryIssues, forcesSeparate, linesRequestedBy, manualRemaining, noteRequired, typesFor, valuesOf, type EntryValues, type Issue,
} from './costEntries';

interface Props {
  order: VendorOrder;
  teamName: (id: string) => string;
  baseDigits: number;
  /** The entry to edit, or null to add one. */
  entry: CostEntry | null;
  open: boolean;
  onClose: () => void;
}

function Form({ order, teamName, baseDigits, entry, onClose }: Omit<Props, 'open'>) {
  const { t } = useTranslation('purchasing');
  const tc = (k: string, o?: Record<string, unknown>) => t(`costs.${k}`, o);
  const baseCurrency = useBaseCurrency();
  const supported = useMeta().data?.supportedCurrencies ?? [order.currency];
  const create = useCreateCostEntry(order.id);
  const put = usePutCostEntry(order.id);
  const mutation = entry ? put : create;
  const placed = order.status === 'placed';
  const form = useForm<EntryValues>({ defaultValues: entry ? valuesOf(entry) : emptyValues(order) });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [shown, setShown] = useState(false);
  const v = useWatch({ control: form.control }) as EntryValues;
  const lineIds = order.lines.map((l) => l.id);
  const { settlement, currency } = effective(v, order.currency);
  const separate = settlement === 'separate';
  const teamIds = [...new Set(order.lines.map((l) => l.teamId))];
  const err = (path: string) => {
    const i = (shown ? issues : []).find((x) => x.path.join('.') === path);
    return i ? t(i.message) : undefined;
  };
  const byRequester = new Map<string, { name: string; count: number }>();
  for (const l of order.lines) {
    if (!l.requester) continue;
    const cur = byRequester.get(l.requester.id);
    byRequester.set(l.requester.id, { name: l.requester.displayName, count: (cur?.count ?? 0) + 1 });
  }

  const submit = form.handleSubmit((values) => {
    const found = entryIssues(values, order, baseDigits, lineIds);
    setIssues(found);
    setShown(true);
    if (found.length > 0) return;
    const body = bodyOf(values, order, baseCurrency);
    if (entry) put.mutate({ entry, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  });
  // Re-check on every change once the user has tried to save.
  const recheck = () => shown && setIssues(entryIssues(form.getValues(), order, baseDigits, lineIds));
  const remaining = v.mode === 'manual' ? manualRemaining(v.amount, v.manual, lineIds) : null;
  const sign = v.type === 'discount' || v.type === 'refund' ? 'negative' : v.type === 'coupon_used' || v.type === 'extra_charge' ? 'positive' : 'any';

  return (
    <>
      <Dialog.Body>
        <form id="cost-entry-form" onSubmit={submit} onChange={recheck} noValidate>
          <Stack gap="3">
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="type" render={({ field }) => (
                <SelectField
                  label={tc('type')} name={field.name} value={field.value} errorText={err('type')} required
                  onChange={(x) => { if (!x) return; field.onChange(x); if (forcesSeparate(x)) form.setValue('settlement', 'separate'); recheck(); }}
                  options={[...new Set([...typesFor(placed), ...(entry ? [entry.type] : [])])].map((x) => ({ value: x, label: tc(`types.${x}`) }))}
                  helperText={!placed ? tc('placedOnlyHint') : undefined}
                />
              )} />
              <Controller control={form.control} name="settlement" render={({ field }) => (
                <SelectField
                  label={tc('settlement')} name={field.name} value={separate ? 'separate' : 'with_checkout'} disabled={forcesSeparate(v.type)} required
                  onChange={(x) => x && field.onChange(x)}
                  options={[{ value: 'with_checkout', label: tc('settlements.with_checkout') }, { value: 'separate', label: tc('settlements.separate') }]}
                  helperText={forcesSeparate(v.type) ? tc('forcedSeparate') : tc(`settlementHelp.${separate ? 'separate' : 'with_checkout'}`)}
                />
              )} />
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="currency" render={({ field }) => (
                <SelectField
                  label={tc('currency')} name={field.name} value={currency} disabled={!separate} onChange={(x) => x && field.onChange(x)} options={supported}
                  helperText={!separate ? tc('currencyLocked', { currency: order.currency }) : undefined}
                />
              )} />
              <FormField
                label={tc('amount', { currency })} required errorText={err('amount')}
                helperText={tc(`signHint.${sign}`) + (v.type === 'coupon_used' ? ` ${tc('couponUsedHint')}` : '')}
              >
                <Input inputMode="decimal" {...form.register('amount')} />
              </FormField>
            </SimpleGrid>
            {separate && currency !== baseCurrency && (
              <FormField label={tc('actualBase', { currency: baseCurrency })} helperText={tc('actualHelp')} errorText={err('actual')}>
                <Input inputMode="decimal" {...form.register('actual')} />
              </FormField>
            )}
            {v.type === 'refund' && (
              <Controller control={form.control} name="refundMethod" render={({ field }) => (
                <SelectField
                  label={tc('refundMethod')} name={field.name} value={field.value} onChange={(x) => x && field.onChange(x)}
                  options={[{ value: 'cash', label: tc('methods.cash') }, { value: 'coupon', label: tc('methods.coupon') }]}
                  helperText={field.value === 'coupon' ? tc('couponRefundHint') : undefined}
                />
              )} />
            )}

            <Controller control={form.control} name="mode" render={({ field }) => (
              <SelectField
                label={tc('splitTo')} name={field.name} value={field.value} onChange={(x) => { if (x) { field.onChange(x); recheck(); } }}
                options={(['all', 'teams', 'lines', 'manual'] as const).map((m) => ({ value: m, label: tc(`modes.${m}`) }))}
                helperText={tc(`modeHelp.${v.mode}`)}
              />
            )} />
            {v.mode === 'teams' && (
              <Stack gap="1">
                <Controller control={form.control} name="teamIds" render={({ field }) => (
                  <Fieldset.Root>
                    <Fieldset.Legend textStyle="sm" fontWeight="medium">{tc('pickTeams')}</Fieldset.Legend>
                    <CheckboxGroup value={field.value} onValueChange={(x) => { field.onChange(x); recheck(); }}>
                      <Box maxH="40" overflowY="auto" borderWidth="1px" rounded="md" px="3" py="2">
                        <Stack gap="1.5">
                          {teamIds.map((id) => (
                            <Checkbox.Root key={id} value={id} size="sm">
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                              <Checkbox.Label>{teamName(id)}</Checkbox.Label>
                            </Checkbox.Root>
                          ))}
                        </Stack>
                      </Box>
                    </CheckboxGroup>
                  </Fieldset.Root>
                )} />
                {err('teamIds') && <Text textStyle="xs" color="fg.error">{err('teamIds')}</Text>}
              </Stack>
            )}
            {v.mode === 'lines' && (
              <Stack gap="2">
                {byRequester.size > 0 && (
                  <SelectField
                    label={tc('byRequester')} value="" placeholder={tc('byRequesterPlaceholder')} helperText={tc('byRequesterHelp')}
                    onChange={(r) => {
                      if (!r) return;
                      const picked = linesRequestedBy(order.lines, r);
                      form.setValue('lineIds', [...new Set([...form.getValues('lineIds'), ...picked])]);
                      recheck();
                    }}
                    options={[...byRequester].map(([id, r]) => ({ value: id, label: `${r.name} (${tc('lineCount', { count: r.count })})` }))}
                  />
                )}
                <Controller control={form.control} name="lineIds" render={({ field }) => (
                  <Fieldset.Root>
                    <Fieldset.Legend textStyle="sm" fontWeight="medium">{tc('pickLines')}</Fieldset.Legend>
                    <CheckboxGroup value={field.value} onValueChange={(x) => { field.onChange(x); recheck(); }}>
                      <Box maxH="40" overflowY="auto" borderWidth="1px" rounded="md" px="3" py="2">
                        <Stack gap="1.5">
                          {order.lines.map((l) => (
                            <Checkbox.Root key={l.id} value={l.id} size="sm">
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                              <Checkbox.Label>{`#${l.lineNo} ${l.name} (${teamName(l.teamId)})`}</Checkbox.Label>
                            </Checkbox.Root>
                          ))}
                        </Stack>
                      </Box>
                    </CheckboxGroup>
                  </Fieldset.Root>
                )} />
                {err('lineIds') && <Text textStyle="xs" color="fg.error">{err('lineIds')}</Text>}
              </Stack>
            )}
            {v.mode === 'manual' && (
              <Stack gap="2">
                <Text textStyle="sm" fontWeight="medium">{tc('manualAmounts', { currency })}</Text>
                {order.lines.map((l) => (
                  <FormField key={l.id} label={`#${l.lineNo} ${l.name} (${teamName(l.teamId)})`} errorText={err(`manual.${l.id}`)}>
                    <Input size="sm" inputMode="decimal" {...form.register(`manual.${l.id}` as `manual.${string}`)} />
                  </FormField>
                ))}
                <Text textStyle="sm" color={err('manual') ? 'fg.error' : 'fg.muted'} role="status">
                  {tc('remaining', { amount: remaining ?? '—', currency })}{err('manual') ? ` ${err('manual')}` : ''}
                </Text>
              </Stack>
            )}

            <FormField label={tc('note')} required={noteRequired(v.type, v.mode)} helperText={v.type === 'coupon_used' || v.type === 'refund' ? tc('noteCouponHelp') : undefined} errorText={err('note')}>
              <Textarea autoresize rows={2} {...form.register('note')} />
            </FormField>
            {entry && (
              <Alert.Root status="info">
                <Alert.Indicator />
                <Alert.Description>{tc('editAudit')}</Alert.Description>
              </Alert.Root>
            )}
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="cost-entry-form" loading={mutation.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Add or edit one cost entry of the vendor order (purchasers). */
export function CostEntryModal({ open, onClose, entry, ...rest }: Props) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={open} onClose={onClose} title={entry ? t('costs.edit') : t('costs.add')}>
      {open && <Form key={entry?.id ?? 'new'} entry={entry} onClose={onClose} {...rest} />}
    </AppDialog>
  );
}
