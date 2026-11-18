import { Button, Card, Stack, Text } from '@chakra-ui/react';
import { EmptyState, FilterBar, SelectionBar, type RowAction } from '@team6083/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCopy, LuPackageOpen, LuPencil, LuPlus, LuRotateCcw, LuSearchX, LuUndo2, LuX } from 'react-icons/lu';
import { useItemAction } from '../../api/batches';
import { useReferenceRates } from '../../api/vendors';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { SelectField } from '../../components/ui/select';
import { UndoDialog } from '../../components/UndoDialog';
import { PRIORITIES, priorityLabel } from '../teams/priority';
import { EstimateSummary, useEstimateText } from './EstimateSummary';
import { ItemFormModal } from './ItemFormModal';
import { ItemsTable } from './ItemsTable';
import { TO_PURCHASE, countsTowardEstimate, filterItems, type ItemFilters } from './filters';
import { ReviewBar } from './ReviewBar';
import {
  canAddItem, canCopyItem, canForceReject, canMarkUnpurchasable, canModifyItem, canResubmitItem, canReview, canUndoReview, canUndoUnpurchasable,
  inPurchasing, isMember, showResubmit, type Caller,
} from './rules';

interface Props {
  batch: Batch;
  team: Team | undefined;
  caller: Caller;
  items: Item[];
  nameOf: (id: string) => string;
  defaultSubgroupId: string;
}

const distinct = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
/** Values present in the items, plus the chosen one if no item has it any more, so a native select never shows "All" while filtering. */
const withChosen = (values: string[], chosen: string | undefined) => (chosen && !values.includes(chosen) ? [...values, chosen] : values);

export function ItemsTab({ batch, team, caller, items, nameOf, defaultSubgroupId }: Props) {
  const { t } = useTranslation('batches');
  // The status filter starts where this caller works (pending for approvers, approved-and-still-to-purchase for purchasers); once
  // chosen it sticks until the batch changes status, then the default for the new status applies again.
  const defaultStatus = canReview(batch, caller) ? 'pending' : caller.isPurchaser && inPurchasing(batch) ? TO_PURCHASE : undefined;
  const statusLabel = (s: string) => (s === TO_PURCHASE ? t('filters.toPurchase') : t(`itemStatus.${s}`, { defaultValue: s }));
  const availableStatuses = [
    ...(items.some((i) => i.status === 'approved' && i.toPurchaseQuantity > 0) ? [TO_PURCHASE] : []),
    ...distinct(items.map((i) => i.status)),
  ];
  const [others, setOthers] = useState<Omit<ItemFilters, 'status'>>({});
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<{ key: string; value: string | undefined } | null>(null);
  // The default applies only when some item has that status; otherwise the list would be empty while the select shows "All".
  const status = chosen && chosen.key === `${batch.status}:${defaultStatus ?? ''}`
    ? chosen.value
    : defaultStatus && availableStatuses.includes(defaultStatus) ? defaultStatus : undefined;
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const [unbuyable, setUnbuyable] = useState<Item | null>(null);
  const [forcing, setForcing] = useState<Item | null>(null);
  const [undoing, setUndoing] = useState<{ item: Item; what: 'review' | 'unpurchasable' } | null>(null);
  const [copyFrom, setCopyFrom] = useState<Item | null>(null);
  const action = useItemAction();
  const internal = isMember(caller) || caller.isSystemAdmin;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = filterItems(items, { ...others, status });
    return q ? filtered.filter((i) => [i.name, i.vendorName, i.sku].some((s) => s.toLowerCase().includes(q))) : filtered;
  }, [items, others, status, search]);
  const selected = visible.filter((i) => picked.includes(i.id));
  const rates = useReferenceRates().data ?? [];
  const selectedEstimate = useEstimateText(selected, rates);
  const set = (k: keyof Omit<ItemFilters, 'status'>) => (v: string) => setOthers((f) => ({ ...f, [k]: v || undefined }));
  const setStatus = (v: string) => setChosen({ key: `${batch.status}:${defaultStatus ?? ''}`, value: v || undefined });
  const decidable = selected.filter((i) => i.status === 'pending');
  const clearSelection = () => setPicked([]);
  const activeCount = [...Object.values(others), status].filter(Boolean).length;
  const clearFilters = () => { setOthers({}); setStatus(''); };
  // A chosen status stays listed after its last item moves on, so the select always shows the filter actually applied.
  const statusOptions = withChosen(availableStatuses, status).map((s) => ({ value: s, label: statusLabel(s) }));

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
    if (canUndoUnpurchasable(it, batch, caller)) {
      out.push({ value: 'unpurchasable-undo', icon: <LuUndo2 />, label: t('item.unpurchasableUndo'), onSelect: () => { action.reset(); setUndoing({ item: it, what: 'unpurchasable' }); } });
    }
    if (canUndoReview(it, batch, caller)) {
      out.push({ value: 'review-undo', icon: <LuUndo2 />, label: t('item.undoReview'), onSelect: () => { action.reset(); setUndoing({ item: it, what: 'review' }); } });
    }
    if (canCopyItem(it, batch, caller)) {
      out.push({ value: 'copy', icon: <LuCopy />, label: t('item.copy'), onSelect: () => { setCopyFrom(it); setEditing('new'); } });
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
        positioning={{ placement: "right-start" }}
        search={{ value: search, onChange: setSearch, placeholder: t('filters.searchItems') }}
        activeCount={activeCount}
        onClear={clearFilters}
        actions={canAddItem(batch, caller) && (
          <Button size="sm" onClick={() => { setCopyFrom(null); setEditing('new'); }}>
            <LuPlus />
            {t('item.add')}
          </Button>
        )}
      >
        <SelectField size="sm" label={t('item.status')} placeholder={t('filters.all')} value={status} onChange={setStatus} options={statusOptions} />
        <SelectField size="sm" label={t('item.subgroup')} placeholder={t('filters.all')} value={others.subgroup} onChange={set('subgroup')}
          options={withChosen(distinct(items.map((i) => i.subgroupId)), others.subgroup).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? '—' }))} />
        {internal && (
          <SelectField size="sm" label={t('item.requester')} placeholder={t('filters.all')} value={others.requester} onChange={set('requester')}
            options={withChosen(distinct(items.map((i) => i.requesterId)), others.requester).map((id) => ({ value: id, label: nameOf(id) }))} />
        )}
        <SelectField size="sm" label={t('item.priority')} placeholder={t('filters.all')} value={others.priority} onChange={set('priority')}
          options={PRIORITIES.map((p) => ({ value: p, label: priorityLabel(team?.priorityLabels, p, (k) => t(`teams:priority.default.${k}`)) }))} />
        <SelectField size="sm" label={t('item.vendor')} placeholder={t('filters.all')} value={others.vendor} onChange={set('vendor')}
          options={withChosen(distinct(items.map((i) => i.vendorName)), others.vendor)} />
      </FilterBar>

      {internal && batch.status === 'reviewing' && !canReview(batch, caller) && <Text color="fg.muted">{t('review.readOnly')}</Text>}

      <ErrorAlert error={action.variables?.action === 'resubmit' ? action.error : null} />
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
      {visible.length > 0 && <EstimateSummary items={visible.filter(countsTowardEstimate)} rates={rates} hint={t('totals.excludes')} />}

      <SelectionBar count={selected.length} onClear={clearSelection}>
        <Text textStyle="sm" color="fg.muted" fontVariantNumeric="tabular-nums">{selectedEstimate}</Text>
        {internal && batch.status === 'reviewing' && <ReviewBar batch={batch} caller={caller} selected={decidable} onDone={clearSelection} />}
      </SelectionBar>

      <ItemFormModal open={editing !== null} onClose={() => { setEditing(null); setCopyFrom(null); }} batch={batch} team={team} defaultSubgroupId={defaultSubgroupId} item={editing && editing !== 'new' ? editing : undefined} prefill={editing === 'new' ? copyFrom ?? undefined : undefined} />
      <ReasonModal
        open={!!withdrawing}
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
        open={!!forcing}
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
      <UndoDialog
        open={!!undoing}
        title={undoing?.what === 'review' ? t('item.undoReview') : t('item.unpurchasableUndo')}
        body={undoing?.what === 'review' ? t('item.undoReviewHelp', { name: undoing.item.name }) : t('item.unpurchasableUndoHelp', { name: undoing?.item.name })}
        confirmLabel={undoing?.what === 'review' ? t('item.undoReview') : t('item.unpurchasableUndo')}
        loading={action.isPending}
        error={undoing ? action.error : null}
        onClose={() => setUndoing(null)}
        onConfirm={(reason) => undoing && action.mutate({ item: undoing.item, action: undoing.what === 'review' ? 'review/undo' : 'unpurchasable/undo', reason }, { onSuccess: () => setUndoing(null) })}
      />
      <ReasonModal
        open={!!unbuyable}
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
