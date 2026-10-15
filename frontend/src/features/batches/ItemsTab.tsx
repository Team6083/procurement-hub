import { Button, Group, Select, Stack, Text, Tooltip } from '@mantine/core';
import type { RowSelectionState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemAction } from '../../api/batches';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { EstimateSummary } from './EstimateSummary';
import { ItemFormModal } from './ItemFormModal';
import { ItemsTable } from './ItemsTable';
import { countsTowardEstimate, filterItems, type ItemFilters } from './filters';
import { canAddItem, canModifyItem, canResubmitItem, showResubmit, type Caller } from './rules';

interface Props {
  batch: Batch;
  team: Team | undefined;
  caller: Caller;
  items: Item[];
  nameOf: (id: string) => string;
  defaultSubgroupId: string;
}

const distinct = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();

export function ItemsTab({ batch, team, caller, items, nameOf, defaultSubgroupId }: Props) {
  const { t } = useTranslation('batches');
  const [filters, setFilters] = useState<ItemFilters>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const action = useItemAction(batch.id);

  const visible = useMemo(() => filterItems(items, filters), [items, filters]);
  const selected = visible.filter((i) => selection[i.id]);
  const rates = team?.referenceRates ?? [];
  const set = (k: keyof ItemFilters) => (v: string | null) => setFilters((f) => ({ ...f, [k]: v ?? undefined }));
  const opts = (xs: { value: string; label: string }[]) => xs;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="xs">
          <Select size="xs" label={t('item.subgroup')} clearable placeholder={t('filters.all')} value={filters.subgroup ?? null} onChange={set('subgroup')}
            data={opts(distinct(items.map((i) => i.subgroupId)).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? id })))} />
          <Select size="xs" label={t('item.requester')} clearable placeholder={t('filters.all')} value={filters.requester ?? null} onChange={set('requester')}
            data={opts(distinct(items.map((i) => i.requesterId)).map((id) => ({ value: id, label: nameOf(id) })))} />
          <Select size="xs" label={t('item.priority')} clearable placeholder={t('filters.all')} value={filters.priority ?? null} onChange={set('priority')}
            data={['5', '4', '3', '2', '1']} />
          <Select size="xs" label={t('item.status')} clearable placeholder={t('filters.all')} value={filters.status ?? null} onChange={set('status')}
            data={opts(distinct(items.map((i) => i.status)).map((s) => ({ value: s, label: t(`itemStatus.${s}`, { defaultValue: s }) })))} />
          <Select size="xs" label={t('item.vendor')} clearable placeholder={t('filters.all')} value={filters.vendor ?? null} onChange={set('vendor')}
            data={distinct(items.map((i) => i.vendor))} />
        </Group>
        {canAddItem(batch, caller) && <Button onClick={() => setEditing('new')}>{t('item.add')}</Button>}
      </Group>

      {items.length === 0 ? (
        <Text c="dimmed">{t('item.empty')}</Text>
      ) : (
        <ItemsTable
          items={visible}
          team={team}
          nameOf={nameOf}
          selection={selection}
          onSelectionChange={setSelection}
          actions={(it) => (
            <>
              {canModifyItem(it, batch, caller) && <Button size="compact-xs" variant="default" onClick={() => setEditing(it)}>{t('common:actions.edit')}</Button>}
              {canModifyItem(it, batch, caller) && <Button size="compact-xs" variant="light" color="red" onClick={() => { action.reset(); setWithdrawing(it); }}>{t('item.withdraw')}</Button>}
              {showResubmit(it, batch, caller) && (
                <Tooltip label={t('item.resubmitNeedsEdit')} disabled={canResubmitItem(it, batch, caller)}>
                  <span>
                    <Button size="compact-xs" disabled={!canResubmitItem(it, batch, caller)} loading={action.isPending && action.variables?.item.id === it.id}
                      onClick={() => action.mutate({ item: it, action: 'resubmit' })}>
                      {t('item.resubmit')}
                    </Button>
                  </span>
                </Tooltip>
              )}
            </>
          )}
        />
      )}
      <ErrorAlert error={action.variables?.action === 'resubmit' ? action.error : null} />

      <Group align="flex-start" gap="xl">
        <EstimateSummary items={visible.filter(countsTowardEstimate)} rates={rates} label={t('totals.visible')} />
        {selected.length > 0 && <EstimateSummary items={selected} rates={rates} label={t('totals.selected', { count: selected.length })} />}
      </Group>

      <ItemFormModal opened={editing !== null} onClose={() => setEditing(null)} batch={batch} team={team} defaultSubgroupId={defaultSubgroupId} item={editing && editing !== 'new' ? editing : undefined} />
      <ReasonModal
        opened={!!withdrawing}
        title={t('item.withdraw')}
        body={t('item.withdrawConfirm', { name: withdrawing?.name })}
        confirmLabel={t('item.withdraw')}
        danger
        loading={action.isPending}
        error={withdrawing ? action.error : null}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => withdrawing && action.mutate({ item: withdrawing, action: 'withdraw' }, { onSuccess: () => setWithdrawing(null) })}
      />
    </Stack>
  );
}
