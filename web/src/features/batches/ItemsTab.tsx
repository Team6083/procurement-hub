import { Box, Button, Card, Flex, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import type { RowSelectionState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemAction } from '../../api/batches';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { SelectField } from '../../components/ui/select';
import { Tooltip } from '../../components/ui/tooltip';
import { OrderBar } from '../orders/OrderBar';
import { canCreateOrder } from '../orders/rules';
import { EstimateSummary } from './EstimateSummary';
import { ItemFormModal } from './ItemFormModal';
import { ItemsTable } from './ItemsTable';
import { TO_ORDER, countsTowardEstimate, filterItems, type ItemFilters } from './filters';
import { ReviewBar } from './ReviewBar';
import { canAddItem, canForceReject, canMarkUnpurchasable, canModifyItem, canResubmitItem, canReview, isMember, showResubmit, type Caller } from './rules';
import { EmptyState } from '@team6083/ui';
import { LuPackageOpen, LuSearchX } from 'react-icons/lu';

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
  // The status filter starts where this caller works (pending for approvers, approved-without-order for purchasers); once
  // chosen it sticks until the batch changes status, then the default for the new status applies again.
  const defaultStatus = canReview(batch, caller) ? 'pending' : canCreateOrder(batch, caller) ? TO_ORDER : undefined;
  const [others, setOthers] = useState<Omit<ItemFilters, 'status'>>({});
  const [chosen, setChosen] = useState<{ key: string; value: string | undefined } | null>(null);
  const status = chosen && chosen.key === `${batch.status}:${defaultStatus ?? ''}` ? chosen.value : defaultStatus;
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const [unbuyable, setUnbuyable] = useState<Item | null>(null);
  const [forcing, setForcing] = useState<Item | null>(null);
  const action = useItemAction(batch.id);

  const visible = useMemo(() => filterItems(items, { ...others, status }), [items, others, status]);
  const selected = visible.filter((i) => selection[i.id]);
  const rates = team?.referenceRates ?? [];
  const set = (k: keyof Omit<ItemFilters, 'status'>) => (v: string) => setOthers((f) => ({ ...f, [k]: v || undefined }));
  const setStatus = (v: string) => setChosen({ key: `${batch.status}:${defaultStatus ?? ''}`, value: v || undefined });
  const internal = isMember(caller) || caller.isSystemAdmin;
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const decidable = selected.filter((i) => i.status === 'pending');
  const orderable = selected.filter((i) => i.status === 'approved' && !i.orderId);
  const clearSelection = () => setSelection({});
  const statusOptions = [
    ...(items.some((i) => i.status === 'approved' && !i.orderId) ? [{ value: TO_ORDER, label: t('filters.toOrder') }] : []),
    ...distinct(items.map((i) => i.status)).map((s) => ({ value: s, label: t(`itemStatus.${s}`, { defaultValue: s }) })),
  ];

  return (
    <Stack gap="4">
      <Flex justify="space-between" align="flex-end" gap="3" wrap="wrap">
        <SimpleGrid columns={{ base: 2, md: 5 }} gap="2" flex="1" maxW={{ md: '4xl' }}>
          <SelectField label={t('item.subgroup')} placeholder={t('filters.all')} value={others.subgroup} onChange={set('subgroup')}
            options={distinct(items.map((i) => i.subgroupId)).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? id }))} />
          <SelectField label={t('item.requester')} placeholder={t('filters.all')} value={others.requester} onChange={set('requester')}
            options={distinct(items.map((i) => i.requesterId)).map((id) => ({ value: id, label: nameOf(id) }))} />
          <SelectField label={t('item.priority')} placeholder={t('filters.all')} value={others.priority} onChange={set('priority')}
            options={['5', '4', '3', '2', '1']} />
          <SelectField label={t('item.status')} placeholder={t('filters.all')} value={status} onChange={setStatus}
            options={statusOptions} />
          <SelectField label={t('item.vendor')} placeholder={t('filters.all')} value={others.vendor} onChange={set('vendor')}
            options={distinct(items.map((i) => i.vendor))} />
        </SimpleGrid>
        {canAddItem(batch, caller) && <Button onClick={() => setEditing('new')}>{t('item.add')}</Button>}
      </Flex>

      {items.length === 0 ? (
        <Card.Root size="sm">
          <Card.Body>
            <EmptyState icon={<LuPackageOpen />} title={t('item.empty')} />
          </Card.Body>
        </Card.Root>
      ) : visible.length === 0 ? (
        <Card.Root size="sm">
          <Card.Body>
            <EmptyState icon={<LuSearchX />} title={t('filters.noMatch')} description={t('filters.noMatchHint')} />
          </Card.Body>
        </Card.Root>
      ) : (
        <ItemsTable
          items={visible}
          team={team}
          nameOf={nameOf}
          selection={selection}
          onSelectionChange={setSelection}
          actions={(it) => (
            <>
              {canModifyItem(it, batch, caller) && <Button variant="outline" onClick={() => setEditing(it)}>{t('common:actions.edit')}</Button>}
              {canModifyItem(it, batch, caller) && <Button variant="subtle" colorPalette="red" onClick={() => { action.reset(); setWithdrawing(it); }}>{t('item.withdraw')}</Button>}
              {canMarkUnpurchasable(it, batch, caller) && (
                <Button variant="subtle" colorPalette="red" onClick={() => { action.reset(); setUnbuyable(it); }}>{t('item.unpurchasable')}</Button>
              )}
              {canForceReject(it, batch, caller) && (
                <Button variant="subtle" colorPalette="red" onClick={() => { action.reset(); setForcing(it); }}>{t('review.forceReject')}</Button>
              )}
              {showResubmit(it, batch, caller) && (
                <Tooltip content={t('item.resubmitNeedsEdit')} disabled={canResubmitItem(it, batch, caller)}>
                  <Box as="span" display="inline-block">
                    <Button disabled={!canResubmitItem(it, batch, caller)} loading={action.isPending && action.variables?.item.id === it.id}
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

      {internal && batch.status === 'reviewing' && (
        <Stack gap="3">
          <Text fontWeight="semibold">{t('review.pending', { count: pendingCount })}</Text>
          <ReviewBar batch={batch} caller={caller} selected={decidable} onDone={clearSelection} />
        </Stack>
      )}
      <OrderBar batch={batch} caller={caller} selected={orderable} onDone={clearSelection} />

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
      <ReasonModal
        opened={!!forcing}
        title={t('review.forceReject')}
        body={t('review.forceHelp', { name: forcing?.name })}
        reasonLabel={t('review.reason')}
        confirmLabel={t('review.forceReject')}
        danger
        loading={action.isPending}
        error={forcing ? action.error : null}
        onClose={() => setForcing(null)}
        onConfirm={(reason) => forcing && action.mutate({ item: forcing, action: 'force-reject', reason }, { onSuccess: () => setForcing(null) })}
      />
      <ReasonModal
        opened={!!unbuyable}
        title={t('item.unpurchasable')}
        body={t('item.unpurchasableHelp', { name: unbuyable?.name })}
        reasonLabel={t('item.unpurchasableReason')}
        confirmLabel={t('item.unpurchasable')}
        danger
        loading={action.isPending}
        error={unbuyable ? action.error : null}
        onClose={() => setUnbuyable(null)}
        onConfirm={(reason) => unbuyable && action.mutate({ item: unbuyable, action: 'unpurchasable', reason }, { onSuccess: () => setUnbuyable(null) })}
      />
    </Stack>
  );
}
