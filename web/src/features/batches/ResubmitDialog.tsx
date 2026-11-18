import { Button, Dialog, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Item } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { isEditedSinceReturn } from './rules';

interface Props {
  item: Item | null;
  loading?: boolean;
  error?: unknown;
  onConfirm: (note: string) => void;
  onClose: () => void;
}

function Inner({ item, loading, error, onConfirm }: Omit<Props, 'onClose'> & { item: Item }) {
  const { t } = useTranslation('batches');
  const [note, setNote] = useState('');
  // Without an edit since the return, the reply is what lets the item go back to review (spec §10.2).
  const needsNote = !isEditedSinceReturn(item);
  const blocked = needsNote && note.trim() === '';
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <Text>{t('item.resubmitHelp', { name: item.name })}</Text>
          <FormField label={t('item.resubmitNote')} required={needsNote} helperText={needsNote ? t('item.resubmitNeedsNote') : t('item.resubmitNoteOptional')}>
            <Textarea autoresize rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <ErrorAlert error={error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={loading} disabled={blocked} onClick={() => onConfirm(note.trim())}>{t('item.resubmit')}</Button>
      </DialogFooter>
    </>
  );
}

/** Resubmit a returned item with an optional reply to the approver (required when the item was not edited). */
export function ResubmitDialog({ item, onClose, ...rest }: Props) {
  const { t } = useTranslation('batches');
  return (
    <AppDialog open={!!item} onClose={onClose} title={t('item.resubmit')} size="sm">
      {item && <Inner item={item} {...rest} />}
    </AppDialog>
  );
}
