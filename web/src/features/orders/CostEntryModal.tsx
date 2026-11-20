import { Alert, Box, Button, Checkbox, CheckboxGroup, Dialog, Fieldset, Input, NativeSelect, SimpleGrid, Stack, Text, Textarea } from '@chakra-ui/react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useBaseCurrency, useMeta } from '../../api/meta';
import type { CostEntry, VendorOrder } from '../../api/types';
import { useCreateCostEntry, usePutCostEntry } from '../../api/vendorOrders';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
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
                <FormField label={tc('type')} helperText={!placed ? tc('placedOnlyHint') : undefined} errorText={err('type')} required>
                  <NativeSelect.Root size="md">
                    <NativeSelect.Field
                      name={field.name}
                      value={field.value ?? ''}
                      onChange={(e) => { const x = e.currentTarget.value as typeof field.value; if (!x) return; field.onChange(x); if (forcesSeparate(x)) form.setValue('settlement', 'separate'); recheck(); }}
                    >
                      {!field.value && <option value="" />}
                      {[...new Set([...typesFor(placed), ...(entry ? [entry.type] : [])])].map((x) => (
                        <option key={x} value={x}>{tc(`types.${x}`)}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
              )} />
              <Controller control={form.control} name="settlement" render={({ field }) => (
                <FormField label={tc('settlement')} helperText={forcesSeparate(v.type) ? tc('forcedSeparate') : tc(`settlementHelp.${separate ? 'separate' : 'with_checkout'}`)} required disabled={forcesSeparate(v.type)}>
                  <NativeSelect.Root size="md" disabled={forcesSeparate(v.type)}>
                    <NativeSelect.Field
                      name={field.name}
                      value={separate ? 'separate' : 'with_checkout'}
                      onChange={(e) => e.currentTarget.value && field.onChange(e.currentTarget.value)}
                    >
                      <option value="with_checkout">{tc('settlements.with_checkout')}</option>
                      <option value="separate">{tc('settlements.separate')}</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
              )} />
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="currency" render={({ field }) => (
                <FormField label={tc('currency')} helperText={!separate ? tc('currencyLocked', { currency: order.currency }) : undefined} disabled={!separate}>
                  <NativeSelect.Root size="md" disabled={!separate}>
                    <NativeSelect.Field
                      name={field.name}
                      value={currency ?? ''}
                      onChange={(e) => e.currentTarget.value && field.onChange(e.currentTarget.value)}
                    >
                      {!currency && <option value="" />}
                      {supported.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
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
                <FormField label={tc('refundMethod')} helperText={field.value === 'coupon' ? tc('couponRefundHint') : undefined}>
                  <NativeSelect.Root size="md">
                    <NativeSelect.Field
                      name={field.name}
                      value={field.value ?? ''}
                      onChange={(e) => e.currentTarget.value && field.onChange(e.currentTarget.value)}
                    >
                      {!field.value && <option value="" />}
                      <option value="cash">{tc('methods.cash')}</option>
                      <option value="coupon">{tc('methods.coupon')}</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
              )} />
            )}

            <Controller control={form.control} name="mode" render={({ field }) => (
              <FormField label={tc('splitTo')} helperText={tc(`modeHelp.${v.mode}`)}>
                <NativeSelect.Root size="md">
                  <NativeSelect.Field
                    name={field.name}
                    value={field.value ?? ''}
                    onChange={(e) => { const x = e.currentTarget.value; if (x) { field.onChange(x); recheck(); } }}
                  >
                    {!field.value && <option value="" />}
                    {(['all', 'teams', 'lines', 'manual'] as const).map((m) => (
                      <option key={m} value={m}>{tc(`modes.${m}`)}</option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
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
                  <FormField label={tc('byRequester')} helperText={tc('byRequesterHelp')}>
                    <NativeSelect.Root size="md">
                      <NativeSelect.Field
                        value=""
                        onChange={(e) => {
                          const r = e.currentTarget.value;
                          if (!r) return;
                          const picked = linesRequestedBy(order.lines, r);
                          form.setValue('lineIds', [...new Set([...form.getValues('lineIds'), ...picked])]);
                          recheck();
                        }}
                      >
                        <option value="">{tc('byRequesterPlaceholder')}</option>
                        {[...byRequester].map(([id, r]) => (
                          <option key={id} value={id}>{`${r.name} (${tc('lineCount', { count: r.count })})`}</option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </FormField>
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
