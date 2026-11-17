import { Button, Dialog, Input, SimpleGrid, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAddItem, usePutItem } from '../../api/batches';
import { useVendors } from '../../api/vendors';
import { useMeta } from '../../api/meta';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { PRIORITIES, priorityLabel } from '../teams/priority';
import { emptyItemForm, itemFormSchema, itemToForm, toItemRequest, type ItemForm } from './itemForm';

interface Props {
  opened: boolean;
  onClose: () => void;
  batch: Batch;
  team: Team | undefined;
  /** Caller's default subgroup in this team (used for new items). */
  defaultSubgroupId: string;
  item?: Item;
  /** A withdrawn item whose content prefills a new item (copy as new item). */
  prefill?: Item;
}

function Inner({ onClose, batch, team, defaultSubgroupId, item, prefill }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('batches');
  const meta = useMeta();
  const vendors = useVendors();
  const add = useAddItem(batch.id);
  const patch = usePutItem();
  const currencies = meta.data?.supportedCurrencies ?? [];
  const base = meta.data?.baseCurrency ?? currencies[0] ?? '';
  const activeDefault = team?.subgroups.some((g) => g.id === defaultSubgroupId && g.active) ? defaultSubgroupId : '';
  const form = useForm<ItemForm>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: item ? itemToForm(item) : prefill ? itemToForm(prefill) : emptyItemForm(base, activeDefault),
  });
  const vendorChoice = useWatch({ control: form.control, name: 'vendorId' });
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  const mutation = item ? patch : add;
  const label = (k: string) => priorityLabel(team?.priorityLabels, k as '1', (x) => t(`teams:priority.default.${x}`));
  const submit = form.handleSubmit((v) => {
    const body = toItemRequest(v);
    if (item) patch.mutate({ item, body }, { onSuccess: onClose });
    else add.mutate(body, { onSuccess: onClose });
  });
  const subgroups = (team?.subgroups ?? []).filter((g) => g.active || g.id === item?.subgroupId);
  return (
    <>
      <Dialog.Body>
        <form id="item-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('item.name')} errorText={msg(err.name?.message)}>
              <Input {...form.register('name')} />
            </FormField>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="vendorId" render={({ field }) => (
                <SelectField label={t('item.vendor')} placeholder={t('item.noVendor')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur}
                  options={[...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })), { value: 'other', label: t('item.vendorOther') }]} />
              )} />
              {vendorChoice === 'other' && (
                <FormField label={t('item.vendorOtherName')}>
                  <Input {...form.register('vendorName')} />
                </FormField>
              )}
              <FormField label={t('item.sku')}>
                <Input {...form.register('sku')} />
              </FormField>
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, sm: 3 }} gap="3">
              <FormField label={t('item.quantity')} errorText={msg(err.quantity?.message)}>
                <Input inputMode="numeric" {...form.register('quantity')} />
              </FormField>
              <FormField label={t('item.unitPrice')} errorText={msg(err.unitPrice?.message)}>
                <Input inputMode="decimal" {...form.register('unitPrice')} />
              </FormField>
              <Controller control={form.control} name="currency" render={({ field }) => (
                <SelectField label={t('item.currency')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={currencies} errorText={msg(err.currency?.message)} />
              )} />
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="priority" render={({ field }) => (
                <SelectField label={t('item.priority')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={PRIORITIES.map((k) => ({ value: k, label: `${k} - ${label(k)}` }))} />
              )} />
              <Controller control={form.control} name="subgroupId" render={({ field }) => (
                <SelectField label={t('item.subgroup')} placeholder={t('item.noSubgroup')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={subgroups.map((g) => ({ value: g.id, label: g.name }))} />
              )} />
            </SimpleGrid>
            <FormField label={t('item.purpose')} errorText={msg(err.purpose?.message)}>
              <Textarea autoresize rows={2} {...form.register('purpose')} />
            </FormField>
            <FormField label={t('item.productUrl')} errorText={msg(err.productUrl?.message)}>
              <Input type="url" placeholder="https://" {...form.register('productUrl')} />
            </FormField>
            <FormField label={t('item.notes')}>
              <Textarea autoresize rows={2} {...form.register('notes')} />
            </FormField>
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="item-form" loading={mutation.isPending}>{item ? t('common:actions.save') : t('item.add')}</Button>
      </DialogFooter>
    </>
  );
}

export function ItemFormModal(props: Props) {
  const { t } = useTranslation('batches');
  return (
    <AppDialog open={props.opened} onClose={props.onClose} title={props.item ? t('item.editTitle') : t('item.addTitle')} size="lg">
      <Inner {...props} />
    </AppDialog>
  );
}
