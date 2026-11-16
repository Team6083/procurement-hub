import { Button, HStack, Input, Stack, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { fromLocalInput, toLocalInput } from './datetime';

interface Props {
  opened: boolean;
  title: string;
  required: boolean;
  initial?: string | null;
  loading?: boolean;
  error?: unknown;
  onClose: () => void;
  /** When set, a non-blank reason is collected and required too (undo of a cancellation). */
  reasonLabel?: string;
  /** Receives an RFC 3339 UTC timestamp, or undefined when left empty (only when not required), and the reason. */
  onConfirm: (deadline: string | undefined, reason: string) => void;
}

function Inner({ title, required, initial, loading, error, reasonLabel, onClose, onConfirm }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('batches');
  const [value, setValue] = useState(toLocalInput(initial));
  const parsed = fromLocalInput(value);
  const [reason, setReason] = useState('');
  const valid = (parsed === null ? !required : parsed !== undefined) && (!reasonLabel || !!reason.trim());
  return (
    <Stack gap="4">
      <FormField label={t('header.deadline')} helperText={required ? t('actions.deadlineRequired') : t('actions.deadlineOptional')}>
        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      </FormField>
      {reasonLabel && (
        <FormField label={reasonLabel}>
          <Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoresize rows={2} />
        </FormField>
      )}
      <ErrorAlert error={error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={loading} disabled={!valid} onClick={() => onConfirm(parsed ?? undefined, reason.trim())}>{title}</Button>
      </HStack>
    </Stack>
  );
}

export function DeadlineModal({ opened, ...rest }: Props) {
  return (
    <AppDialog open={opened} onClose={rest.onClose} title={rest.title}>
      <Inner {...rest} />
    </AppDialog>
  );
}
