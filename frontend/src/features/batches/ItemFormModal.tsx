import { Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAddItem, usePutItem } from '../../api/batches';
import { useMeta } from '../../api/meta';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
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
      <Stack>
        <TextInput label={t('item.name')} error={msg(err.name?.message)} data-autofocus {...form.register('name')} />
        <Group grow align="flex-start">
          <TextInput label={t('item.vendor')} {...form.register('vendor')} />
          <TextInput label={t('item.sku')} {...form.register('sku')} />
        </Group>
        <Group grow align="flex-start">
          <TextInput label={t('item.quantity')} inputMode="numeric" error={msg(err.quantity?.message)} {...form.register('quantity')} />
          <TextInput label={t('item.unitPrice')} inputMode="decimal" error={msg(err.unitPrice?.message)} {...form.register('unitPrice')} />
          <Controller control={form.control} name="currency" render={({ field }) => (
            <Select label={t('item.currency')} allowDeselect={false} data={currencies} error={msg(err.currency?.message)} {...field} />
          )} />
        </Group>
        <Controller control={form.control} name="priority" render={({ field }) => (
          <Select label={t('item.priority')} allowDeselect={false} data={PRIORITIES.map((k) => ({ value: k, label: `${k} - ${label(k)}` }))} {...field} />
        )} />
        <Controller control={form.control} name="subgroupId" render={({ field }) => (
          <Select label={t('item.subgroup')} clearable placeholder={t('item.noSubgroup')} data={subgroups.map((g) => ({ value: g.id, label: g.name }))} value={field.value || null} onChange={(v) => field.onChange(v ?? '')} />
        )} />
        <Textarea label={t('item.purpose')} autosize minRows={2} error={msg(err.purpose?.message)} {...form.register('purpose')} />
        <TextInput label={t('item.productUrl')} placeholder="https://" error={msg(err.productUrl?.message)} {...form.register('productUrl')} />
        <Textarea label={t('item.notes')} autosize minRows={2} {...form.register('notes')} />
        <ErrorAlert error={mutation.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={mutation.isPending}>{item ? t('common:actions.save') : t('item.add')}</Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ItemFormModal(props: Props) {
  const { t } = useTranslation('batches');
  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.item ? t('item.editTitle') : t('item.addTitle')} size="lg">
      {props.opened && <Inner {...props} />}
    </Modal>
  );
}
