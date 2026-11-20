import { Button, Dialog, Input, Stack, Switch, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useMeta } from '../../api/meta';
import { useCreateVendor, usePutVendor, type VendorBody } from '../../api/vendors';
import type { Vendor } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { requiredText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { safeHttpUrl } from '../batches/itemForm';

const vendorSchema = z.object({
  name: requiredText(200),
  aliases: z.string(),
  currency: z.string(),
  website: z.string().trim().refine((v) => v === '' || safeHttpUrl(v) !== undefined, 'admin:vendors.badUrl'),
  notes: z.string(),
  active: z.boolean(),
});

function Inner({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const meta = useMeta();
  const create = useCreateVendor();
  const put = usePutVendor();
  const base = meta.data?.baseCurrency ?? '';
  const currencies = meta.data?.supportedCurrencies ?? [];
  const form = useForm({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: vendor?.name ?? '', aliases: (vendor?.aliases ?? []).join('\n'), currency: vendor?.defaultCurrency ?? base,
      website: vendor?.website ?? '', notes: vendor?.notes ?? '', active: vendor?.active ?? true,
    },
  });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const mutation = vendor ? put : create;
  const submit = form.handleSubmit((v) => {
    const body: VendorBody = {
      name: v.name.trim(), aliases: v.aliases.split('\n').map((a) => a.trim()).filter(Boolean), defaultCurrency: v.currency,
      website: v.website.trim(), notes: v.notes, active: v.active,
    };
    if (vendor) put.mutate({ vendor, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  });
  return (
    <>
      <Dialog.Body>
        <form id="vendor-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('vendors.name')} required errorText={fieldError(err.name)}><Input maxLength={200} {...form.register('name')} /></FormField>
            <FormField label={t('vendors.aliases')} helperText={t('vendors.aliasesHelp')}>
              <Textarea autoresize rows={2} {...form.register('aliases')} />
            </FormField>
            <Controller control={form.control} name="currency" render={({ field }) => (
              <SelectField label={t('vendors.currency')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={currencies.length ? currencies : [base]} />
            )} />
            <FormField label={t('vendors.website')} errorText={fieldError(err.website)}>
              <Input inputMode="url" {...form.register('website')} />
            </FormField>
            <FormField label={t('vendors.notes')}><Textarea autoresize rows={2} {...form.register('notes')} /></FormField>
            {vendor && (
              <Controller control={form.control} name="active" render={({ field }) => (
                <Switch.Root checked={field.value} onCheckedChange={(e) => field.onChange(e.checked)}>
                  <Switch.HiddenInput onBlur={field.onBlur} />
                  <Switch.Control />
                  <Switch.Label>{t('vendors.active')}</Switch.Label>
                </Switch.Root>
              )} />
            )}
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="vendor-form" loading={mutation.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Create or edit a vendor; deactivate instead of deleting. */
export function VendorModal({ open, vendor, onClose }: { open: boolean; vendor: Vendor | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <AppDialog open={open} onClose={onClose} title={vendor ? t('vendors.edit') : t('vendors.create')}>
      <Inner vendor={vendor} onClose={onClose} />
    </AppDialog>
  );
}
