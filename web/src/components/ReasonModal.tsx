import { Button, HStack, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from './ErrorAlert';
import { AppDialog } from './ui/dialog';
import { FormField } from './ui/field';

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

function Inner({ body, confirmLabel, danger, reasonLabel, loading, error, onConfirm, onClose }: Omit<Props, 'opened' | 'title'>) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const needsReason = !!reasonLabel;
  return (
    <Stack gap="4">
      {body && <Text fontSize="sm">{body}</Text>}
      {needsReason && (
        <FormField label={reasonLabel}>
          <Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoresize rows={2} />
        </FormField>
      )}
      <ErrorAlert error={error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('actions.cancel')}</Button>
        <Button colorPalette={danger ? 'red' : undefined} loading={loading} disabled={needsReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </Button>
      </HStack>
    </Stack>
  );
}

/** Confirmation dialog with an optional required reason/comment. */
export function ReasonModal({ opened, title, onClose, ...rest }: Props) {
  return (
    <AppDialog open={opened} onClose={onClose} title={title}>
      <Inner onClose={onClose} {...rest} />
    </AppDialog>
  );
}
