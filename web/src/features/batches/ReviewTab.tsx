import { Button, Flex, HStack, Stack, Text } from '@chakra-ui/react';
import type { RowSelectionState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemAction, useReview } from '../../api/batches';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { EstimateSummary } from './EstimateSummary';
import { ItemsTable } from './ItemsTable';
import { canForceReject, canReview, type Caller } from './rules';

type Pending = 'return' | 'reject' | 'force' | null;

export function ReviewTab({ batch, team, caller, items, nameOf }: { batch: Batch; team: Team | undefined; caller: Caller; items: Item[]; nameOf: (id: string) => string }) {
  const { t } = useTranslation('batches');
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [dialog, setDialog] = useState<Pending>(null);
  const [forceTarget, setForceTarget] = useState<Item | null>(null);
  const review = useReview(batch.id);
  const itemAction = useItemAction(batch.id);
  const reviewer = canReview(batch, caller);

  const pending = useMemo(() => items.filter((i) => i.status === 'pending'), [items]);
  const returned = useMemo(() => items.filter((i) => i.status === 'returned'), [items]);
  const selected = pending.filter((i) => selection[i.id]);
  const rates = team?.referenceRates ?? [];

  const decide = (decision: 'approve' | 'return' | 'reject', comment?: string) =>
    review.mutate(
      { decisions: selected.map((i) => ({ itemId: i.id, decision, ...(comment ? { comment } : {}) })) },
      { onSuccess: () => { setSelection({}); setDialog(null); } },
    );

  if (batch.status !== 'reviewing' && pending.length === 0 && returned.length === 0) return <Text color="fg.muted">{t('review.notReviewing')}</Text>;

  return (
    <Stack gap="4">
      {!reviewer && <Text color="fg.muted" fontSize="sm">{t('review.readOnly')}</Text>}
      <Text fontWeight="semibold">{t('review.pending', { count: pending.length })}</Text>
      {pending.length === 0 ? <Text color="fg.muted">{t('review.nonePending')}</Text> : (
        <ItemsTable
          items={pending}
          team={team}
          nameOf={nameOf}
          selectable={reviewer}
          selection={selection}
          onSelectionChange={setSelection}
          actions={(it) => canForceReject(it, batch, caller) ? (
            <Button size="2xs" colorPalette="red" variant="subtle" onClick={() => { itemAction.reset(); setForceTarget(it); setDialog('force'); }}>{t('review.forceReject')}</Button>
          ) : null}
        />
      )}
      {reviewer && (
        <HStack wrap="wrap">
          <Button disabled={selected.length === 0} loading={review.isPending && review.variables?.decisions[0]?.decision === 'approve'} onClick={() => decide('approve')}>{t('review.approve', { count: selected.length })}</Button>
          <Button variant="subtle" colorPalette="orange" disabled={selected.length === 0} onClick={() => { review.reset(); setDialog('return'); }}>{t('review.return')}</Button>
          <Button variant="subtle" colorPalette="red" disabled={selected.length === 0} onClick={() => { review.reset(); setDialog('reject'); }}>{t('review.reject')}</Button>
        </HStack>
      )}
      {dialog === null && <ErrorAlert error={review.error} />}
      <Flex align="flex-start" gap="8" wrap="wrap">
        <EstimateSummary items={pending} rates={rates} label={t('totals.pending')} />
        {selected.length > 0 && <EstimateSummary items={selected} rates={rates} label={t('totals.selected', { count: selected.length })} />}
      </Flex>

      {returned.length > 0 && (
        <>
          <Text fontWeight="semibold">{t('review.returned', { count: returned.length })}</Text>
          <ItemsTable
            items={returned}
            team={team}
            nameOf={nameOf}
            selectable={false}
            selection={{}}
            onSelectionChange={() => undefined}
            actions={(it) => canForceReject(it, batch, caller) ? (
              <Button size="2xs" colorPalette="red" variant="subtle" onClick={() => { itemAction.reset(); setForceTarget(it); setDialog('force'); }}>{t('review.forceReject')}</Button>
            ) : null}
          />
        </>
      )}

      <ReasonModal
        opened={dialog === 'return' || dialog === 'reject'}
        title={dialog === 'reject' ? t('review.reject') : t('review.return')}
        body={t('review.commentHelp', { count: selected.length })}
        reasonLabel={t('review.comment')}
        confirmLabel={dialog === 'reject' ? t('review.reject') : t('review.return')}
        danger={dialog === 'reject'}
        loading={review.isPending}
        error={review.error}
        onClose={() => setDialog(null)}
        onConfirm={(c) => decide(dialog === 'reject' ? 'reject' : 'return', c)}
      />
      <ReasonModal
        opened={dialog === 'force'}
        title={t('review.forceReject')}
        body={t('review.forceHelp', { name: forceTarget?.name })}
        reasonLabel={t('review.reason')}
        confirmLabel={t('review.forceReject')}
        danger
        loading={itemAction.isPending}
        error={itemAction.error}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => forceTarget && itemAction.mutate({ item: forceTarget, action: 'force-reject', reason }, { onSuccess: () => setDialog(null) })}
      />
    </Stack>
  );
}
