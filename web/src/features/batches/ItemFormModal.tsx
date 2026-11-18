import { Button, Dialog, Group, Input, NativeSelect, SimpleGrid, Stack, Textarea } from '@chakra-ui/react';
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
import { useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { PRIORITIES, priorityLabel } from '../teams/priority';
import { emptyItemForm, itemFormSchema, itemToForm, toItemRequest, type ItemForm } from './itemForm';

interface Props {
  open: boolean;
  onClose: () => void;
  batch: Batch;
  team: Team | undefined;
  /** Caller's default subgroup in this team (used for new items). */
  defaultSubgroupId: string;
  item?: Item;
  /** A withdrawn item whose content prefills a new item (copy as new item). */
  prefill?: Item;
}

function Inner({ onClose, batch, team, defaultSubgroupId, item, prefill }: Omit<Props, 'open'>) {
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
  const fieldError = useFieldError();
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
            <FormField label={t('item.name')} required errorText={fieldError(err.name)}>
              <Input {...form.register('name')} />
            </FormField>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="vendorId" render={({ field }) => (
                <SelectField label={t('item.vendor')} placeholder={t('item.noVendor')} name={field.name} value={field.value} onBlur={field.onBlur}
                  // Choosing a listed vendor fills in its default currency (still changeable afterwards).
                  onChange={(id) => {
                    field.onChange(id);
                    const currency = vendors.data?.find((v) => v.id === id)?.defaultCurrency;
                    if (currency && currencies.includes(currency)) form.setValue('currency', currency, { shouldDirty: true });
                  }}
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
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <FormField label={t('item.quantity')} required errorText={fieldError(err.quantity)}>
                <Input inputMode="numeric" {...form.register('quantity')} />
              </FormField>
              {/* Price and currency read as one input: the currency is the price's end addon. */}
              <FormField label={t('item.unitPrice')} required errorText={fieldError(err.unitPrice) ?? fieldError(err.currency)}>
                <Group attached w="full">
                  <Input flex="1" inputMode="decimal" {...form.register('unitPrice')} />
                  <Controller control={form.control} name="currency" render={({ field }) => (
                    <NativeSelect.Root width="auto" invalid={!!err.currency}>
                      <NativeSelect.Field
                        aria-label={t('item.currency')}
                        borderLeftRadius="0"
                        name={field.name}
                        value={field.value}
                        onChange={(e) => field.onChange(e.currentTarget.value)}
                        onBlur={field.onBlur}
                      >
                        {!field.value && <option value="" />}
                        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  )} />
                </Group>
              </FormField>
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <Controller control={form.control} name="priority" render={({ field }) => (
                <SelectField label={t('item.priority')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={PRIORITIES.map((k) => ({ value: k, label: `${k} - ${label(k)}` }))} />
              )} />
              <Controller control={form.control} name="subgroupId" render={({ field }) => (
                <SelectField label={t('item.subgroup')} placeholder={t('item.noSubgroup')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={subgroups.map((g) => ({ value: g.id, label: g.name }))} />
              )} />
            </SimpleGrid>
            <FormField label={t('item.purpose')} required errorText={fieldError(err.purpose)}>
              <Textarea autoresize rows={2} {...form.register('purpose')} />
            </FormField>
            <FormField label={t('item.productUrl')} errorText={fieldError(err.productUrl)}>
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
    <AppDialog open={props.open} onClose={props.onClose} title={props.item ? t('item.editTitle') : t('item.addTitle')} size="lg">
      <Inner {...props} />
    </AppDialog>
  );
}
