import { Button, Dialog, Input, NativeSelect, SimpleGrid, Stack } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAddLine, usePutLine } from '../../api/vendorOrders';
import type { TeamSummary, VendorOrder, VendorOrderLine } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { amountText, positiveInt, requiredText, useFieldError } from '../../components/ui/form';
import { currencyFractionDigits } from '../money';

interface Props {
  order: VendorOrder;
  teams: TeamSummary[];
  /** The line to edit, or null to add a standalone line. */
  line: VendorOrderLine | null;
  open: boolean;
  onClose: () => void;
}

/** A placed order needs a price on every line; a draft may leave it empty. */
const lineSchema = (currency: string, placed: boolean) => z.object({
  teamId: requiredText(),
  name: requiredText(),
  sku: z.string(),
  quantity: positiveInt('purchasing:line.quantityInvalid'),
  price: amountText({ digits: currencyFractionDigits(currency) }, !placed),
});

function Form({ order, teams, line, onClose }: Omit<Props, 'open'>) {
  const { t } = useTranslation('purchasing');
  const add = useAddLine(order.id);
  const put = usePutLine(order.id);
  const placed = order.status === 'placed';
  const linked = !!line?.itemId;
  const mutation = line ? put : add;
  const form = useForm({
    resolver: zodResolver(lineSchema(order.currency, placed)),
    defaultValues: { teamId: line?.teamId ?? '', name: line?.name ?? '', sku: line?.sku ?? '', quantity: String(line?.quantity ?? 1), price: line?.unitPrice ?? '' },
  });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => {
    const body = { teamId: v.teamId, name: v.name.trim(), sku: v.sku.trim(), quantity: Number(v.quantity), unitPrice: v.price.trim() || null };
    if (line) put.mutate({ line, body }, { onSuccess: onClose });
    else add.mutate(body, { onSuccess: onClose });
  });

  return (
    <>
      <Dialog.Body>
        <form id="line-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Controller control={form.control} name="teamId" render={({ field }) => (
              <FormField label={t('line.team')} errorText={fieldError(err.teamId)} required disabled={placed || linked}>
                <NativeSelect.Root size="md" disabled={placed || linked}>
                  <NativeSelect.Field
                    name={field.name}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.currentTarget.value)}
                    onBlur={field.onBlur}
                  >
                    <option value="">{t('line.chooseTeam')}</option>
                    {teams.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            )} />
            <FormField label={t('line.name')} required errorText={fieldError(err.name)}><Input {...form.register('name')} /></FormField>
            <FormField label={t('line.sku')}><Input {...form.register('sku')} /></FormField>
            <SimpleGrid columns={2} gap="3">
              <FormField label={t('line.quantity')} required errorText={fieldError(err.quantity)} disabled={placed}>
                <Input inputMode="numeric" {...form.register('quantity')} />
              </FormField>
              <FormField label={t('line.unitPrice', { currency: order.currency })} required={placed} errorText={fieldError(err.price)}>
                <Input inputMode="decimal" {...form.register('price')} />
              </FormField>
            </SimpleGrid>
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="line-form" loading={mutation.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Add a standalone line to a draft order, or edit a line (after placing: name, SKU and price only). */
export function LineFormModal({ open, onClose, ...rest }: Props) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={open} onClose={onClose} title={rest.line ? t('line.edit') : t('line.add')}>
      <Form onClose={onClose} {...rest} />
    </AppDialog>
  );
}
