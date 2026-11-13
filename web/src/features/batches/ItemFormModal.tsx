import { Button, HStack, Input, SimpleGrid, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAddItem, usePutItem } from '../../api/batches';
import { useMeta } from '../../api/meta';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
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
}

function Inner({ onClose, batch, team, defaultSubgroupId, item }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('batches');
  const meta = useMeta();
  const add = useAddItem(batch.id);
  const patch = usePutItem(batch.id);
  const currencies = meta.data?.supportedCurrencies ?? [];
  const base = meta.data?.baseCurrency ?? currencies[0] ?? '';
  const activeDefault = team?.subgroups.some((g) => g.id === defaultSubgroupId && g.active) ? defaultSubgroupId : '';
  const form = useForm<ItemForm>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: item ? itemToForm(item) : emptyItemForm(base, activeDefault),
  });
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
    <form onSubmit={submit} noValidate>
      <Stack gap="4">
        <FormField label={t('item.name')} errorText={msg(err.name?.message)}>
          <Input {...form.register('name')} />
        </FormField>
        <SimpleGrid columns={{ base: 1, sm: 2 }} gap="4">
          <FormField label={t('item.vendor')}>
            <Input {...form.register('vendor')} />
          </FormField>
          <FormField label={t('item.sku')}>
            <Input {...form.register('sku')} />
          </FormField>
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, sm: 3 }} gap="4">
          <FormField label={t('item.quantity')} errorText={msg(err.quantity?.message)}>
            <Input inputMode="numeric" {...form.register('quantity')} />
          </FormField>
          <FormField label={t('item.unitPrice')} errorText={msg(err.unitPrice?.message)}>
            <Input inputMode="decimal" {...form.register('unitPrice')} />
          </FormField>
          <Controller control={form.control} name="currency" render={({ field }) => (
            <SelectField size="md" label={t('item.currency')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={currencies} errorText={msg(err.currency?.message)} />
          )} />
        </SimpleGrid>
        <Controller control={form.control} name="priority" render={({ field }) => (
          <SelectField size="md" label={t('item.priority')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={PRIORITIES.map((k) => ({ value: k, label: `${k} - ${label(k)}` }))} />
        )} />
        <Controller control={form.control} name="subgroupId" render={({ field }) => (
          <SelectField size="md" label={t('item.subgroup')} placeholder={t('item.noSubgroup')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={subgroups.map((g) => ({ value: g.id, label: g.name }))} />
        )} />
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
        <HStack justify="flex-end">
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={mutation.isPending}>{item ? t('common:actions.save') : t('item.add')}</Button>
        </HStack>
      </Stack>
    </form>
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
