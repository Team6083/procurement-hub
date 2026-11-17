import { Box, Button } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReview } from '../../api/batches';
import type { Batch, Item } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { canReview, type Caller } from './rules';

interface Props {
  batch: Batch;
  caller: Caller;
  /** Pending items among the selected rows: only these can be decided. */
  selected: Item[];
  /** Called after a decision was saved, to clear the selection. */
  onDone: () => void;
}

/**
 * The review decisions for the picked rows, shown in the items' SelectionBar: approve, return or reject the
 * selected pending items. Renders nothing for a caller who cannot review or when no pending item is picked.
 */
export function ReviewBar({ batch, caller, selected, onDone }: Props) {
  const { t } = useTranslation('batches');
  const [dialog, setDialog] = useState<'return' | 'reject' | null>(null);
  const review = useReview(batch.id);

  if (!canReview(batch, caller) || selected.length === 0) return null;

  const decide = (decision: 'approve' | 'return' | 'reject', comment?: string) =>
    review.mutate(
      { decisions: selected.map((i) => ({ itemId: i.id, decision, ...(comment ? { comment } : {}) })) },
      { onSuccess: () => { onDone(); setDialog(null); } },
    );

  return (
    <>
      {dialog === null && review.error && <Box w="full"><ErrorAlert error={review.error} /></Box>}
      <Button size="sm" variant="outline" colorPalette="red" onClick={() => { review.reset(); setDialog('reject'); }}>{t('review.reject')}</Button>
      <Button size="sm" variant="outline" onClick={() => { review.reset(); setDialog('return'); }}>{t('review.return')}</Button>
      <Button size="sm" loading={review.isPending && review.variables?.decisions[0]?.decision === 'approve'} onClick={() => decide('approve')}>
        {t('review.approve', { count: selected.length })}
      </Button>
      <ReasonModal
        open={dialog !== null}
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
    </>
  );
}
