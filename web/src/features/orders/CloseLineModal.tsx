import { Button, Dialog, Input, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useCloseLine } from '../../api/vendorOrders';
import type { VendorOrderLine } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { amountText, requiredText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';

const closeSchema = (baseDigits: number) => z.object({
  type: z.enum(['short_accepted', 'not_obtained']),
  reason: requiredText(),
  refund: amountText({ digits: baseDigits, sign: 'nonNegative', nonZero: true }, true),
});

function Form({ orderId, line, baseDigits, onClose }: { orderId: string; line: VendorOrderLine; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  const close = useCloseLine(orderId);
  const form = useForm({ resolver: zodResolver(closeSchema(baseDigits)), defaultValues: { type: 'short_accepted' as const, reason: '', refund: '' } });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => close.mutate({ line, type: v.type, reason: v.reason.trim(), refundBase: v.refund.trim() || null }, { onSuccess: onClose }));
  return (
    <>
      <Dialog.Body>
        <form id="close-line-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Controller control={form.control} name="type" render={({ field }) => (
              <SelectField
                label={t('close.type')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                options={[{ value: 'short_accepted', label: t('close.short_accepted') }, { value: 'not_obtained', label: t('close.not_obtained') }]}
              />
            )} />
            <FormField label={t('undo.reason')} required errorText={fieldError(err.reason)}>
              <Textarea autoresize rows={2} {...form.register('reason')} />
            </FormField>
            <FormField label={t('close.refund')} helperText={t('close.refundHelp')} errorText={fieldError(err.refund)}>
              <Input inputMode="decimal" {...form.register('refund')} />
            </FormField>
            <ErrorAlert error={close.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="close-line-form" colorPalette="red" loading={close.isPending}>{t('close.confirm')}</Button>
      </DialogFooter>
    </>
  );
}

/** Close the missing quantity of a short line (accept the shortage or cancel the rest), optionally with a refund. */
export function CloseLineModal({ orderId, line, baseDigits, onClose }: { orderId: string; line: VendorOrderLine | null; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={!!line} onClose={onClose} title={t('close.title')}>
      {line && <Form orderId={orderId} line={line} baseDigits={baseDigits} onClose={onClose} />}
    </AppDialog>
  );
}
