import { Box, Button, Card, Checkbox, HStack, IconButton, Input, SimpleGrid, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { SectionHeader, toaster } from '@team6083/ui';
import { Controller, useFieldArray, useForm, useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBaseCurrency } from '../../api/meta';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import { z } from 'zod';
import { usePutOrder, type OrderBody } from '../../api/vendorOrders';
import type { Vendor, VendorOrder } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
import { Checklist } from '../../components/ui/checklist';
import { SelectField } from '../../components/ui/select';
import { useRoleHolders } from '../../api/members';
import { useOwnerName } from './owners';
import { add, format, parseDec, ZERO, type Dec } from '../batches/decimal';
import { currencyFractionDigits, formatMoney, validateAmount } from '../money';

const TYPES = ['shipping', 'fee', 'tax', 'discount', 'other'] as const;

const detailsSchema = (baseDigits: number) =>
  z.object({
    vendorId: z.string(),
    currency: z.string(),
    owners: z.array(z.string()),
    externalNo: z.string(),
    delivery: z.string(),
    note: z.string(),
    charged: z.string(),
    costs: z.array(z.object({ type: z.string(), amount: z.string(), note: z.string() })),
    byTeam: z.boolean(),
    overrides: z.array(z.object({ teamId: z.string(), amount: z.string() })),
    reason: z.string(),
  }).superRefine((v, ctx) => {
    const digits = currencyFractionDigits(v.currency) ?? 2;
    const amountIssue = (value: string, path: (string | number)[], rules: Parameters<typeof validateAmount>[1]) => {
      const e = validateAmount(value, rules);
      if (e) ctx.addIssue({ code: 'custom', path, message: `purchasing:amount.${e}` });
    };
    v.costs.forEach((c, i) => amountIssue(c.amount, ['costs', i, 'amount'], { digits, sign: 'any' }));
    if (v.charged.trim()) amountIssue(v.charged, ['charged'], { digits: baseDigits });
    if (!v.byTeam) return;
    v.overrides.forEach((o, i) => amountIssue(o.amount, ['overrides', i, 'amount'], { digits }));
    if (!v.reason.trim()) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'common:validation.required' });
  });
type Details = z.infer<ReturnType<typeof detailsSchema>>;

const toForm = (o: VendorOrder): Details => ({
  vendorId: o.vendorId, currency: o.currency, owners: o.ownerIds, externalNo: o.externalOrderNo, delivery: o.expectedDeliveryDate, note: o.paymentNote,
  charged: o.chargedAmountBase ?? '', costs: o.sharedCosts.map((c) => ({ ...c })), byTeam: o.teamCostOverrides !== null,
  overrides: o.teamIds.map((teamId) => ({ teamId, amount: o.teamCostOverrides?.find((x) => x.teamId === teamId)?.amount ?? '' })),
  reason: o.overrideReason,
});

const toBody = (v: Details): OrderBody => ({
  vendorId: v.vendorId, currency: v.currency, ownerIds: v.owners, externalOrderNo: v.externalNo.trim(), sharedCosts: v.costs.map((c) => ({ ...c, note: c.note.trim() })),
  teamCostOverrides: v.byTeam ? v.overrides : null, overrideReason: v.byTeam ? v.reason.trim() : '',
  chargedAmountBase: v.charged.trim() || null, expectedDeliveryDate: v.delivery, paymentNote: v.note.trim(),
});

/** Sum of the amounts that parse; the ones that do not are flagged at their field. */
function sum(amounts: string[]): Dec {
  return amounts.reduce((acc, a) => {
    try {
      return add(acc, parseDec(a));
    } catch {
      return acc;
    }
  }, ZERO);
}

interface PartProps {
  control: Control<Details>;
  register: UseFormRegister<Details>;
  errors: FieldErrors<Details>;
}

/** The order's shared costs (shipping, fees, discounts), one row each. */
function SharedCosts({ control, register, errors, currency }: PartProps & { currency: string }) {
  const { t } = useTranslation('purchasing');
  const fieldError = useFieldError();
  const costs = useFieldArray({ control, name: 'costs' });
  return (
    <Stack gap="2">
      <Text fontWeight="medium">{t('details.sharedCosts', { currency })}</Text>
      {costs.fields.length > 0 && <Text textStyle="xs" color="fg.muted">{t('details.costsHelp')}</Text>}
      {costs.fields.length === 0 && <Text color="fg.muted">{t('details.noSharedCosts')}</Text>}
      {costs.fields.map((c, i) => (
        <HStack key={c.id} gap="2" align="flex-start" wrap={{ base: 'wrap', sm: 'nowrap' }}>
          <Controller control={control} name={`costs.${i}.type`} render={({ field }) => (
            <SelectField
              aria-label={t('details.costType')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur} w={{ base: 'full', sm: '36' }}
              options={TYPES.map((x) => ({ value: x, label: t(`details.costTypes.${x}`) }))}
            />
          )} />
          <FormField errorText={fieldError(errors.costs?.[i]?.amount)} flex="1">
            <Input aria-label={t('details.costAmount')} placeholder={t('details.costAmountPlaceholder')} inputMode="decimal" {...register(`costs.${i}.amount`)} />
          </FormField>
          <FormField flex="2">
            <Input aria-label={t('details.costNote')} placeholder={t('details.costNote')} {...register(`costs.${i}.note`)} />
          </FormField>
          <IconButton variant="ghost" aria-label={t('details.removeCost')} onClick={() => costs.remove(i)}><LuTrash2 /></IconButton>
        </HStack>
      ))}
      <Box>
        <Button size="sm" variant="outline" onClick={() => costs.append({ type: 'shipping', amount: '', note: '' })}><LuPlus />{t('details.addCost')}</Button>
      </Box>
    </Stack>
  );
}

/** The optional per-team split of the shared costs, which must add up to them and needs a reason. */
function TeamAllocation({ control, register, errors, currency, teamName }: PartProps & { currency: string; teamName: (id: string) => string }) {
  const { t } = useTranslation('purchasing');
  const fieldError = useFieldError();
  const [byTeam, overrides, costs] = useWatch({ control, name: ['byTeam', 'overrides', 'costs'] });
  const total = sum(costs.map((c) => c.amount));
  const allocated = sum(overrides.map((o) => o.amount));
  const mismatch = byTeam && format(allocated) !== format(total);
  return (
    <Stack gap="2">
      <Controller control={control} name="byTeam" render={({ field }) => (
        <Checkbox.Root checked={field.value} onCheckedChange={(e) => field.onChange(!!e.checked)}>
          <Checkbox.HiddenInput onBlur={field.onBlur} />
          <Checkbox.Control />
          <Checkbox.Label>{t('details.byTeam')}</Checkbox.Label>
        </Checkbox.Root>
      )} />
      {byTeam && (
        <Stack gap="2">
          {overrides.map((o, i) => (
            <FormField key={o.teamId} label={teamName(o.teamId)} errorText={fieldError(errors.overrides?.[i]?.amount)}>
              <Input inputMode="decimal" {...register(`overrides.${i}.amount`)} />
            </FormField>
          ))}
          {mismatch && <Text color="fg.error">{t('details.overrideMismatch', { total: formatMoney(format(total), currency), allocated: formatMoney(format(allocated), currency) })}</Text>}
          <FormField label={t('details.overrideReason')} required errorText={fieldError(errors.reason)}>
            <Textarea autoresize rows={2} {...register('reason')} />
          </FormField>
        </Stack>
      )}
    </Stack>
  );
}

interface Props {
  order: VendorOrder;
  vendors: Vendor[];
  supported: string[];
  teamName: (id: string) => string;
  baseDigits: number;
  headingAs?: 'h2' | 'h3';
}

/**
 * The editable order fields: vendor order number, shared costs, optional per-team allocation, the amount actually
 * charged, delivery date and note. PUT replaces them all, so the form always sends the whole set.
 *
 * The form follows the order: when the order changes (another write, or the refetch after a version conflict),
 * fields the user did not touch take the new values and edited ones are kept, so a conflict never throws the
 * user's edits away and saving again never reverts the other change.
 */
export function DetailsForm({ order, vendors, supported, teamName, baseDigits, headingAs = 'h2' }: Props) {
  const { t } = useTranslation('purchasing');
  const baseCurrency = useBaseCurrency();
  const put = usePutOrder(order.id);
  const purchasers = useRoleHolders('purchaser').data ?? [];
  const ownerName = useOwnerName();
  // Candidates are the current purchasers; an owner who lost the role stays listed so saving does not drop them.
  const ownerOptions = [
    ...purchasers.map((u) => ({ value: u.id, label: u.displayName || u.username })),
    ...order.ownerIds.filter((id) => !purchasers.some((u) => u.id === id)).map((id) => ({ value: id, label: ownerName(id) })),
  ];
  const draft = order.status === 'draft';
  const form = useForm({ resolver: zodResolver(detailsSchema(baseDigits)), values: toForm(order), resetOptions: { keepDirtyValues: true } });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const currency = useWatch({ control: form.control, name: 'currency' });
  const part = { control: form.control, register: form.register, errors: err };

  const submit = form.handleSubmit((v) => {
    if (v.byTeam && format(sum(v.overrides.map((o) => o.amount))) !== format(sum(v.costs.map((c) => c.amount)))) return;
    put.mutate(toBody(v), {
      onSuccess: (saved) => {
        form.reset(toForm(saved));
        toaster.success({ title: t('details.saved') });
      },
    });
  });
  const discard = () => {
    put.reset();
    form.reset(toForm(order));
  };

  return (
    <Stack gap="2">
      <SectionHeader as={headingAs} mb="0" title={t('details.title')} />
      <Card.Root size="sm">
        <Card.Body>
          <form onSubmit={submit} noValidate>
            <Stack gap="3">
              {draft && (
                <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                  <Controller control={form.control} name="vendorId" render={({ field }) => (
                    <SelectField
                      label={t('details.vendor')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                      options={vendors.filter((v) => v.active || v.id === order.vendorId).map((v) => ({ value: v.id, label: v.name }))}
                    />
                  )} />
                  <Controller control={form.control} name="currency" render={({ field }) => (
                    <SelectField label={t('details.currency')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur} options={supported} />
                  )} />
                </SimpleGrid>
              )}
              <Controller control={form.control} name="owners" render={({ field }) => (
                <Checklist label={t('details.owners')} options={ownerOptions} value={field.value} onChange={field.onChange} emptyText={t('details.noOwners')} />
              )} />
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                <FormField label={t('details.externalNo')}><Input {...form.register('externalNo')} /></FormField>
                <FormField label={t('details.delivery')}><Input type="date" {...form.register('delivery')} /></FormField>
              </SimpleGrid>
              <SharedCosts {...part} currency={currency} />
              {order.teamIds.length > 1 && <TeamAllocation {...part} currency={currency} teamName={teamName} />}
              <FormField label={t('details.charged', { currency: baseCurrency })} helperText={t('details.chargedHelp')} errorText={fieldError(err.charged)}>
                <Input inputMode="decimal" {...form.register('charged')} />
              </FormField>
              <FormField label={t('details.paymentNote')}><Textarea autoresize rows={2} {...form.register('note')} /></FormField>
              <ErrorAlert error={put.error} onDiscard={discard} />
              <HStack justify="flex-end">
                <Button size="sm" type="submit" loading={put.isPending}>{t('common:actions.save')}</Button>
              </HStack>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
