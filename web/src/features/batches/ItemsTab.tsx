import { Button, Card, Stack, Text } from '@chakra-ui/react';
import { FilterMultiSelect, FilterSelect } from '../../components/FilterSelect';
import { EmptyState, FilterBar, SelectionBar, type RowAction } from '@team6083/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCheck, LuCopy, LuPackageOpen, LuPencil, LuPlus, LuRotateCcw, LuSearchX, LuTrash2, LuUndo2, LuX } from 'react-icons/lu';
import { useDeleteItem, useItemAction, useReview } from '../../api/batches';
import { useReferenceRates } from '../../api/vendors';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { PRIORITIES, priorityLabel } from '../teams/priority';
import { EstimateSummary, useEstimateText } from './EstimateSummary';
import { ResubmitDialog } from './ResubmitDialog';
import { ItemFormModal } from './ItemFormModal';
import { ItemsTable } from './ItemsTable';
import { TO_PURCHASE, countsTowardEstimate, filterItems, type ItemFilters } from './filters';
import { ReviewBar } from './ReviewBar';
import {
  canAddItem, canAddRelatedItem, canCopyItem, canDeleteItem, canForceReject, canMarkUnpurchasable, canModifyItem, canReview, canUndoReview, canUndoUnpurchasable,
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
/** Values present in the items, plus the chosen one if no item has it any more, so a select never shows "All" while filtering. */
const withChosen = (values: string[], chosen: string | undefined) => (chosen && !values.includes(chosen) ? [...values, chosen] : values);

export function ItemsTab({ batch, team, caller, items, nameOf, defaultSubgroupId }: Props) {
  const { t } = useTranslation('batches');
  // The status filter starts where this caller works (pending for approvers (with items returned to them), approved-and-still-to-purchase for purchasers); once
  // chosen it sticks until the batch changes status, then the default for the new status applies again.
  const defaultStatus = canReview(batch, caller) ? ['pending', 'returned'] : caller.isPurchaser && inPurchasing(batch) ? [TO_PURCHASE] : [];
  const statusLabel = (s: string) => (s === TO_PURCHASE ? t('filters.toPurchase') : t(`itemStatus.${s}`, { defaultValue: s }));
  const availableStatuses = [
    ...(items.some((i) => i.status === 'approved' && i.toPurchaseQuantity > 0) ? [TO_PURCHASE] : []),
    ...distinct(items.map((i) => i.status)),
  ];
  const [others, setOthers] = useState<Omit<ItemFilters, 'status'>>({});
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<{ key: string; value: string[] } | null>(null);
  // The default applies only when some item has that status; otherwise the list would be empty while the select shows "All".
  const status = chosen && chosen.key === `${batch.status}:${defaultStatus.join(',')}`
    ? chosen.value
    : defaultStatus.filter((s) => availableStatuses.includes(s));
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [unbuyable, setUnbuyable] = useState<Item | null>(null);
  const [forcing, setForcing] = useState<Item | null>(null);
  const [deciding, setDeciding] = useState<{ item: Item; decision: 'return' | 'reject' } | null>(null);
  const review = useReview(batch.id);
  const [undoing, setUndoing] = useState<{ item: Item; what: 'review' | 'unpurchasable' } | null>(null);
  const [copyFrom, setCopyFrom] = useState<Item | null>(null);
  const [relatedTo, setRelatedTo] = useState<Item | null>(null);
  const [resubmitting, setResubmitting] = useState<Item | null>(null);
  const action = useItemAction();
  const remove = useDeleteItem();
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
  const setStatus = (v: string[]) => setChosen({ key: `${batch.status}:${defaultStatus.join(',')}`, value: v });
  const decidable = selected.filter((i) => i.status === 'pending');
  const clearSelection = () => setPicked([]);
  const activeCount = [...Object.values(others), status.length > 0].filter(Boolean).length;
  const clearFilters = () => { setOthers({}); setStatus([]); };
  // A chosen status stays listed after its last item moves on, so the list always shows the filter actually applied.
  const statusOptions = [...availableStatuses, ...status.filter((c) => !availableStatuses.includes(c))].map((s) => ({ value: s, label: statusLabel(s) }));

  const hinted = (label: string, hint: string) => (
    <Stack gap="0">
      <span>{label}</span>
      <Text as="span" textStyle="xs" color="fg.muted">{hint}</Text>
    </Stack>
  );
  const rowActions = (it: Item): RowAction[] => {
    const out: RowAction[] = [];
    if (showResubmit(it, batch, caller)) {
      out.push({ value: 'resubmit', icon: <LuRotateCcw />, label: t('item.resubmit'), onSelect: () => { action.reset(); setResubmitting(it); } });
    }
    if (canAddRelatedItem(it, batch, caller)) {
      out.push({ value: 'add-related', icon: <LuPlus />, label: t('item.addRelated'), onSelect: () => { setCopyFrom(null); setRelatedTo(it); setEditing('new'); } });
    }
    if (canModifyItem(it, batch, caller)) {
      out.push({ value: 'edit', icon: <LuPencil />, label: t('common:actions.edit'), onSelect: () => setEditing(it) });
    }
    // Never-reviewed items are deleted; the rest keep the withdraw flow (spec §10.2).
    if (canDeleteItem(it, batch, caller)) {
      out.push({ value: 'delete', icon: <LuTrash2 />, label: t('item.delete'), danger: true, onSelect: () => { remove.reset(); setDeleting(it); } });
    } else if (canModifyItem(it, batch, caller)) {
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
    if (canReview(batch, caller) && it.status === 'pending') {
      out.push({ value: 'approve', icon: <LuCheck />, label: hinted(t('review.approveItem'), t('review.approveHint')), onSelect: () => { review.reset(); review.mutate({ decisions: [{ itemId: it.id, decision: 'approve' }] }); } });
      out.push({ value: 'return', icon: <LuUndo2 />, label: hinted(t('review.return'), t('review.returnHint')), onSelect: () => { review.reset(); setDeciding({ item: it, decision: 'return' }); } });
      out.push({ value: 'reject', icon: <LuX />, label: hinted(t('review.reject'), t('review.rejectHint')), danger: true, onSelect: () => { review.reset(); setDeciding({ item: it, decision: 'reject' }); } });
    }
    // Pending items are rejected with the review decision above; force-reject is for returned items that wait for the requester.
    if (canForceReject(it, batch, caller) && it.status === 'returned') {
      out.push({ value: 'force-reject', icon: <LuX />, label: hinted(t('review.forceReject'), t('review.forceRejectHint')), danger: true, onSelect: () => { action.reset(); setForcing(it); } });
    }
    if (canCopyItem(batch, caller, items) && (batch.status !== 'reviewing' || it.status === 'withdrawn')) {
      out.push({ value: 'copy', icon: <LuCopy />, label: t('item.copy'), onSelect: () => { setCopyFrom(it); setEditing('new'); } });
    }
    return out;
  };
  const anyActions = items.some((i) => rowActions(i).length > 0);

  return (
    <Stack gap="4">
      <FilterBar
        mb="0"
        // The popover sits beside the button so it does not cover the table. The button grows a count badge as filters are set,
        // which would move a popover anchored to its right edge: give the button the same width with and without the badge.
        positioning={{ placement: 'right-start' }}
        css={{ '& [data-scope="popover"][data-part="trigger"]': { minW: '7rem', justifyContent: 'center' } }}
        search={{ value: search, onChange: setSearch, placeholder: t('filters.searchItems') }}
        activeCount={activeCount}
        onClear={clearFilters}
        actions={canAddItem(batch, caller) && (
          <Button size="sm" onClick={() => { setCopyFrom(null); setRelatedTo(null); setEditing('new'); }}>
            <LuPlus />
            {t('item.add')}
          </Button>
        )}
      >
        <FilterMultiSelect label={t('item.status')} placeholder={t('filters.all')} value={status} onChange={setStatus} options={statusOptions} />
        <FilterSelect label={t('item.subgroup')} value={others.subgroup} onChange={set('subgroup')} allLabel={t('filters.all')} options={withChosen(distinct(items.map((i) => i.subgroupId)), others.subgroup).map((id) => ({ value: id, label: team?.subgroups.find((g) => g.id === id)?.name ?? '—' }))} />
        {internal && (
          <FilterSelect label={t('item.requester')} value={others.requester} onChange={set('requester')} allLabel={t('filters.all')} options={withChosen(distinct(items.map((i) => i.requesterId)), others.requester).map((id) => ({ value: id, label: nameOf(id) }))} />
        )}
        <FilterSelect label={t('item.priority')} value={others.priority} onChange={set('priority')} allLabel={t('filters.all')} options={PRIORITIES.map((p) => ({ value: p, label: priorityLabel(team?.priorityLabels, p, (k) => t(`teams:priority.default.${k}`)) }))} />
        <FilterSelect label={t('item.vendor')} value={others.vendor} onChange={set('vendor')} allLabel={t('filters.all')} options={withChosen(distinct(items.map((i) => i.vendorName)), others.vendor).map((o) => ({ value: o, label: o }))} />
      </FilterBar>

      {internal && batch.status === 'reviewing' && !canReview(batch, caller) && <Text color="fg.muted">{t('review.readOnly')}</Text>}

      <ErrorAlert error={!deciding && review.variables?.decisions[0]?.decision === 'approve' ? review.error : null} />
      <ItemsTable
        items={visible}
        reviewAsIcon={inPurchasing(batch)}
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

      <ItemFormModal open={editing !== null} onClose={() => { setEditing(null); setCopyFrom(null); setRelatedTo(null); }} batch={batch} team={team} defaultSubgroupId={defaultSubgroupId} item={editing && editing !== 'new' ? editing : undefined} resubmittable={editing !== null && editing !== 'new' && showResubmit(editing, batch, caller)} prefill={editing === 'new' ? copyFrom ?? undefined : undefined} relatedTo={editing === 'new' ? relatedTo ?? undefined : undefined} />
      <ResubmitDialog item={resubmitting} loading={action.isPending} error={resubmitting ? action.error : null} onClose={() => setResubmitting(null)}
        onConfirm={(note) => resubmitting && action.mutate({ item: resubmitting, action: 'resubmit', note }, { onSuccess: () => setResubmitting(null) })} />
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
        open={!!deciding}
        title={deciding?.decision === 'reject' ? t('review.reject') : t('review.return')}
        body={`${t('review.commentHelp', { count: 1 })} ${deciding?.decision === 'reject' ? t('review.rejectNote') : t('review.returnNote')}`}
        reasonLabel={t('review.comment')}
        confirmLabel={deciding?.decision === 'reject' ? t('review.reject') : t('review.return')}
        danger={deciding?.decision === 'reject'}
        loading={review.isPending}
        error={deciding ? review.error : null}
        onClose={() => setDeciding(null)}
        onConfirm={(comment) => deciding && review.mutate({ decisions: [{ itemId: deciding.item.id, decision: deciding.decision, comment }] }, { onSuccess: () => setDeciding(null) })}
      />
      <ReasonModal
        open={!!deleting}
        title={t('item.delete')}
        body={t('item.deleteConfirm', { name: deleting?.name })}
        confirmLabel={t('item.delete')}
        danger
        loading={remove.isPending}
        error={deleting ? remove.error : null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
      <ReasonModal
        open={!!forcing}
        title={t('review.forceReject')}
        body={`${t('review.forceHelp', { name: forcing?.name })} ${t('review.forceRejectHint')}`}
        reasonLabel={t('review.reason')}
        confirmLabel={t('review.forceReject')}
        danger
        loading={action.isPending}
        error={forcing ? action.error : null}
        onClose={() => setForcing(null)}
        onConfirm={(reason) => forcing && action.mutate({ item: forcing, action: 'force-reject', reason }, { onSuccess: () => setForcing(null) })}
      />
      <ReasonModal reasonLabel={t('common:undo.reason')}
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
