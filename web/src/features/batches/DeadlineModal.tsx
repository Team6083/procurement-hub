import { Button, HStack, Input, Stack } from '@chakra-ui/react';
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
  /** Receives an RFC 3339 UTC timestamp, or undefined when left empty (only when not required). */
  onConfirm: (deadline: string | undefined) => void;
}

function Inner({ title, required, initial, loading, error, onClose, onConfirm }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('batches');
  const [value, setValue] = useState(toLocalInput(initial));
  const parsed = fromLocalInput(value);
  const valid = parsed === null ? !required : parsed !== undefined;
  return (
    <Stack gap="4">
      <FormField label={t('header.deadline')} helperText={required ? t('actions.deadlineRequired') : t('actions.deadlineOptional')}>
        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      </FormField>
      <ErrorAlert error={error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={loading} disabled={!valid} onClick={() => onConfirm(parsed ?? undefined)}>{title}</Button>
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
