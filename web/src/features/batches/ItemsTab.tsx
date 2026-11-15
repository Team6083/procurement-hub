import { Button, Card, Stack, Text } from '@chakra-ui/react';
import { EmptyState, FilterBar, SelectionBar, type RowAction } from '@team6083/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageOpen, LuPencil, LuPlus, LuRotateCcw, LuSearchX, LuBan, LuUndo2, LuX } from 'react-icons/lu';
import { useItemAction } from '../../api/batches';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { SelectField } from '../../components/ui/select';
import { OrderBar } from '../orders/OrderBar';
import { canCreateOrder } from '../orders/rules';
import { EstimateSummary, useEstimateText } from './EstimateSummary';
import { ItemFormModal } from './ItemFormModal';
import { ItemsTable } from './ItemsTable';
import { TO_ORDER, countsTowardEstimate, filterItems, type ItemFilters } from './filters';
import { ReviewBar } from './ReviewBar';
import { canAddItem, canForceReject, canMarkUnpurchasable, canModifyItem, canResubmitItem, canReview, isMember, showResubmit, type Caller } from './rules';

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
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<{ key: string; value: string | undefined } | null>(null);
  const status = chosen && chosen.key === `${batch.status}:${defaultStatus ?? ''}` ? chosen.value : defaultStatus;
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const [unbuyable, setUnbuyable] = useState<Item | null>(null);
  const [forcing, setForcing] = useState<Item | null>(null);
  const action = useItemAction(batch.id);
  const internal = isMember(caller) || caller.isSystemAdmin;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = filterItems(items, { ...others, status });
    return q ? filtered.filter((i) => [i.name, i.vendor, i.sku].some((s) => s.toLowerCase().includes(q))) : filtered;
  }, [items, others, status, search]);
  const selected = visible.filter((i) => picked.includes(i.id));
  const rates = team?.referenceRates ?? [];
  const selectedEstimate = useEstimateText(selected, rates);
  const set = (k: keyof Omit<ItemFilters, 'status'>) => (v: string) => setOthers((f) => ({ ...f, [k]: v || undefined }));
  const setStatus = (v: string) => setChosen({ key: `${batch.status}:${defaultStatus ?? ''}`, value: v || undefined });
  const decidable = selected.filter((i) => i.status === 'pending');
  const orderable = selected.filter((i) => i.status === 'approved' && !i.orderId);
  const clearSelection = () => setPicked([]);
  const activeCount = [...Object.values(others), status].filter(Boolean).length;
  const clearFilters = () => { setOthers({}); setStatus(''); };
  const statusOptions = [
    ...(items.some((i) => i.status === 'approved' && !i.orderId) ? [{ value: TO_ORDER, label: t('filters.toOrder') }] : []),
    ...distinct(items.map((i) => i.status)).map((s) => ({ value: s, label: t(`itemStatus.${s}`, { defaultValue: s }) })),
  ];

  const rowActions = (it: Item): RowAction[] => {
    const out: RowAction[] = [];
    if (showResubmit(it, batch, caller)) {
      const ready = canResubmitItem(it, batch, caller);
      out.push({
        value: 'resubmit',
        icon: <LuRotateCcw />,
        label: ready ? t('item.resubmit') : (
          <Stack gap="0">
            <span>{t('item.resubmit')}</span>
            <Text as="span" textStyle="xs" color="fg.muted">{t('item.resubmitNeedsEdit')}</Text>
          </Stack>
        ),
        disabled: !ready,
        onSelect: () => action.mutate({ item: it, action: 'resubmit' }),
      });
    }
    if (canModifyItem(it, batch, caller)) {
      out.push({ value: 'edit', icon: <LuPencil />, label: t('common:actions.edit'), onSelect: () => setEditing(it) });
      out.push({ value: 'withdraw', icon: <LuUndo2 />, label: t('item.withdraw'), danger: true, onSelect: () => { action.reset(); setWithdrawing(it); } });
    }
    if (canMarkUnpurchasable(it, batch, caller)) {
      out.push({ value: 'unpurchasable', icon: <LuBan />, label: t('item.unpurchasable'), danger: true, onSelect: () => { action.reset(); setUnbuyable(it); } });
    }
    if (canForceReject(it, batch, caller)) {
      out.push({ value: 'force-reject', icon: <LuX />, label: t('review.forceReject'), danger: true, onSelect: () => { action.reset(); setForcing(it); } });
    }
    return out;
  };
  const anyActions = items.some((i) => rowActions(i).length > 0);

  return (
    <Stack gap="4">
      <FilterBar
        mb="0"
        search={{ value: search, onChange: setSearch, placeholder: t('filters.searchItems') }}
        activeCount={activeCount}
        onClear={clearFilters}
        actions={canAddItem(batch, caller) && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <LuPlus />
            {t('item.add')}
          </Button>
        )}
      >
        <SelectField label={t('item.status')} placeholder={t('filters.all')} value={status} onChange={setStatus} options={statusOptions} />
        <SelectField label={t('item.subgroup')} placeholder={t('filters.all')} value={others.subgroup} onChange={set('subgroup')}
          options={distinct(items.map((i) => i.subgroupId)).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? '—' }))} />
        {internal && (
          <SelectField label={t('item.requester')} placeholder={t('filters.all')} value={others.requester} onChange={set('requester')}
            options={distinct(items.map((i) => i.requesterId)).map((id) => ({ value: id, label: nameOf(id) }))} />
        )}
        <SelectField label={t('item.priority')} placeholder={t('filters.all')} value={others.priority} onChange={set('priority')}
          options={['5', '4', '3', '2', '1']} />
        <SelectField label={t('item.vendor')} placeholder={t('filters.all')} value={others.vendor} onChange={set('vendor')}
          options={distinct(items.map((i) => i.vendor))} />
      </FilterBar>

      {internal && batch.status === 'reviewing' && !canReview(batch, caller) && <Text color="fg.muted">{t('review.readOnly')}</Text>}

      <ItemsTable
        items={visible}
        team={team}
        nameOf={nameOf}
        showRequester={internal}
        selection={{ selected: picked, onChange: setPicked }}
        rowActions={anyActions ? rowActions : undefined}
        empty={
          <Card.Root size="sm">
            <Card.Body>
              {items.length === 0
                ? <EmptyState icon={<LuPackageOpen />} title={t('item.empty')} />
                : <EmptyState icon={<LuSearchX />} title={t('filters.noMatch')} description={t('filters.noMatchHint')} />}
            </Card.Body>
          </Card.Root>
        }
      />
      <ErrorAlert error={action.variables?.action === 'resubmit' ? action.error : null} />
      {visible.length > 0 && <EstimateSummary items={visible.filter(countsTowardEstimate)} rates={rates} hint={t('totals.excludes')} />}

      <SelectionBar count={selected.length} onClear={clearSelection}>
        <Text textStyle="sm" color="fg.muted" fontVariantNumeric="tabular-nums">{selectedEstimate}</Text>
        {internal && batch.status === 'reviewing' && <ReviewBar batch={batch} caller={caller} selected={decidable} onDone={clearSelection} />}
        <OrderBar batch={batch} caller={caller} selected={orderable} onDone={clearSelection} />
      </SelectionBar>

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
