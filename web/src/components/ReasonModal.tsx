import { Button, Dialog, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState, type ReactNode } from 'react';
import { ErrorAlert } from './ErrorAlert';
import { AppDialog, DialogFooter } from './ui/dialog';
import { FormField } from './ui/field';
import { BlockerList } from './UndoDialog';

interface Props {
  opened: boolean;
  title: string;
  /** Explanatory text above the field. */
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, a non-blank reason is collected and required. */
  reasonLabel?: string;
  loading?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

function Inner({ body, confirmLabel, danger, reasonLabel, loading, error, onConfirm }: Omit<Props, 'opened' | 'title' | 'onClose'>) {
  const [reason, setReason] = useState('');
  const needsReason = !!reasonLabel;
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          {body && <Text>{body}</Text>}
          {needsReason && (
            <FormField label={reasonLabel}>
              <Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoresize rows={2} />
            </FormField>
          )}
          <BlockerList error={error} />
          <ErrorAlert error={error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" colorPalette={danger ? 'red' : undefined} loading={loading} disabled={needsReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Confirmation dialog with an optional required reason/comment. */
export function ReasonModal({ opened, title, onClose, ...rest }: Props) {
  return (
    <AppDialog open={opened} onClose={onClose} title={title} size="sm">
      <Inner {...rest} />
    </AppDialog>
  );
}
