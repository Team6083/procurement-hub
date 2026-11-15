import { Button, HStack, Text } from '@chakra-ui/react';
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

/** Batch review actions for the items workspace: approve, return or reject the selected pending items. */
export function ReviewBar({ batch, caller, selected, onDone }: Props) {
  const { t } = useTranslation('batches');
  const [dialog, setDialog] = useState<'return' | 'reject' | null>(null);
  const review = useReview(batch.id);
  const reviewer = canReview(batch, caller);

  const decide = (decision: 'approve' | 'return' | 'reject', comment?: string) =>
    review.mutate(
      { decisions: selected.map((i) => ({ itemId: i.id, decision, ...(comment ? { comment } : {}) })) },
      { onSuccess: () => { onDone(); setDialog(null); } },
    );

  if (!reviewer) return <Text color="fg.muted">{t('review.readOnly')}</Text>;

  return (
    <>
      <HStack wrap="wrap">
        <Button disabled={selected.length === 0} loading={review.isPending && review.variables?.decisions[0]?.decision === 'approve'} onClick={() => decide('approve')}>
          {t('review.approve', { count: selected.length })}
        </Button>
        <Button variant="subtle" colorPalette="orange" disabled={selected.length === 0} onClick={() => { review.reset(); setDialog('return'); }}>{t('review.return')}</Button>
        <Button variant="subtle" colorPalette="red" disabled={selected.length === 0} onClick={() => { review.reset(); setDialog('reject'); }}>{t('review.reject')}</Button>
      </HStack>
      {dialog === null && <ErrorAlert error={review.error} />}
      <ReasonModal
        opened={dialog !== null}
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
