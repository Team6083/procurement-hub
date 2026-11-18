import { Button, Card, HStack, Input, SimpleGrid, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { SectionHeader, toaster } from '@team6083/ui';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBaseCurrency } from '../../api/meta';
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
import { validateAmount } from '../money';

const detailsSchema = (baseDigits: number) =>
  z.object({
    vendorId: z.string(),
    currency: z.string(),
    owners: z.array(z.string()),
    externalNo: z.string(),
    delivery: z.string(),
    note: z.string(),
    charged: z.string(),
  }).superRefine((v, ctx) => {
    if (!v.charged.trim()) return;
    const e = validateAmount(v.charged, { digits: baseDigits });
    if (e) ctx.addIssue({ code: 'custom', path: ['charged'], message: `purchasing:amount.${e}` });
  });
type Details = z.infer<ReturnType<typeof detailsSchema>>;

const toForm = (o: VendorOrder): Details => ({
  vendorId: o.vendorId, currency: o.currency, owners: o.ownerIds, externalNo: o.externalOrderNo, delivery: o.expectedDeliveryDate, note: o.paymentNote,
  charged: o.chargedAmountBase ?? '',
});

const toBody = (v: Details): OrderBody => ({
  vendorId: v.vendorId, currency: v.currency, ownerIds: v.owners, externalOrderNo: v.externalNo.trim(),
  chargedAmountBase: v.charged.trim() || null, expectedDeliveryDate: v.delivery, paymentNote: v.note.trim(),
});

interface Props {
  order: VendorOrder;
  vendors: Vendor[];
  supported: string[];
  baseDigits: number;
  headingAs?: 'h2' | 'h3';
}

/**
 * The editable order fields: vendor order number, the amount actually
 * charged, delivery date and note. PUT replaces them all, so the form always sends the whole set.
 *
 * The form follows the order: when the order changes (another write, or the refetch after a version conflict),
 * fields the user did not touch take the new values and edited ones are kept, so a conflict never throws the
 * user's edits away and saving again never reverts the other change.
 */
export function DetailsForm({ order, vendors, supported, baseDigits, headingAs = 'h2' }: Props) {
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

  const submit = form.handleSubmit((v) => {
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
