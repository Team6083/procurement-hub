import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from '../../components/ErrorAlert';

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

export function DeadlineModal({ opened, title, required, initial, loading, error, onClose, onConfirm }: Props) {
  const { t } = useTranslation('batches');
  const [value, setValue] = useState(toLocalInput(initial));
  const parsed = value ? new Date(value) : undefined;
  const valid = parsed ? !Number.isNaN(parsed.getTime()) : !required;
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <TextInput type="datetime-local" label={t('header.deadline')} description={required ? t('actions.deadlineRequired') : t('actions.deadlineOptional')} value={value} onChange={(e) => setValue(e.currentTarget.value)} data-autofocus />
        <ErrorAlert error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button loading={loading} disabled={!valid} onClick={() => onConfirm(parsed ? parsed.toISOString() : undefined)}>{title}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
