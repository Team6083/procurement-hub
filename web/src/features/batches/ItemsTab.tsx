import { Box, Button, Flex, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import type { RowSelectionState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemAction } from '../../api/batches';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { SelectField } from '../../components/ui/select';
import { Tooltip } from '../../components/ui/tooltip';
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
  const set = (k: keyof ItemFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));

  return (
    <Stack gap="4">
      <Flex justify="space-between" align="flex-end" gap="3" wrap="wrap">
        <SimpleGrid columns={{ base: 2, md: 5 }} gap="2" flex="1" maxW={{ md: '4xl' }}>
          <SelectField size="xs" label={t('item.subgroup')} placeholder={t('filters.all')} value={filters.subgroup} onChange={set('subgroup')}
            options={distinct(items.map((i) => i.subgroupId)).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? id }))} />
          <SelectField size="xs" label={t('item.requester')} placeholder={t('filters.all')} value={filters.requester} onChange={set('requester')}
            options={distinct(items.map((i) => i.requesterId)).map((id) => ({ value: id, label: nameOf(id) }))} />
          <SelectField size="xs" label={t('item.priority')} placeholder={t('filters.all')} value={filters.priority} onChange={set('priority')}
            options={['5', '4', '3', '2', '1']} />
          <SelectField size="xs" label={t('item.status')} placeholder={t('filters.all')} value={filters.status} onChange={set('status')}
            options={distinct(items.map((i) => i.status)).map((s) => ({ value: s, label: t(`itemStatus.${s}`, { defaultValue: s }) }))} />
          <SelectField size="xs" label={t('item.vendor')} placeholder={t('filters.all')} value={filters.vendor} onChange={set('vendor')}
            options={distinct(items.map((i) => i.vendor))} />
        </SimpleGrid>
        {canAddItem(batch, caller) && <Button size="sm" onClick={() => setEditing('new')}>{t('item.add')}</Button>}
      </Flex>

      {items.length === 0 ? (
        <Text color="fg.muted">{t('item.empty')}</Text>
      ) : (
        <ItemsTable
          items={visible}
          team={team}
          nameOf={nameOf}
          selection={selection}
          onSelectionChange={setSelection}
          actions={(it) => (
            <>
              {canModifyItem(it, batch, caller) && <Button size="2xs" variant="outline" onClick={() => setEditing(it)}>{t('common:actions.edit')}</Button>}
              {canModifyItem(it, batch, caller) && <Button size="2xs" variant="subtle" colorPalette="red" onClick={() => { action.reset(); setWithdrawing(it); }}>{t('item.withdraw')}</Button>}
              {showResubmit(it, batch, caller) && (
                <Tooltip content={t('item.resubmitNeedsEdit')} disabled={canResubmitItem(it, batch, caller)}>
                  <Box as="span" display="inline-block">
                    <Button size="2xs" disabled={!canResubmitItem(it, batch, caller)} loading={action.isPending && action.variables?.item.id === it.id}
                      onClick={() => action.mutate({ item: it, action: 'resubmit' })}>
                      {t('item.resubmit')}
                    </Button>
                  </Box>
                </Tooltip>
              )}
            </>
          )}
        />
      )}
      <ErrorAlert error={action.variables?.action === 'resubmit' ? action.error : null} />

      <Flex align="flex-start" gap="8" wrap="wrap">
        <EstimateSummary items={visible.filter(countsTowardEstimate)} rates={rates} label={t('totals.visible')} />
        {selected.length > 0 && <EstimateSummary items={selected} rates={rates} label={t('totals.selected', { count: selected.length })} />}
      </Flex>

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
