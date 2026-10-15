import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorAlert } from './ErrorAlert';

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

/** Confirmation dialog with an optional required reason/comment. */
export function ReasonModal({ opened, title, body, confirmLabel, danger, reasonLabel, loading, error, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const needsReason = !!reasonLabel;
  return (
    <Modal opened={opened} onClose={onClose} title={title} onExitTransitionEnd={() => setReason('')}>
      <Stack>
        {body && <Text size="sm">{body}</Text>}
        {needsReason && <Textarea label={reasonLabel} value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} data-autofocus />}
        <ErrorAlert error={error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('actions.cancel')}</Button>
          <Button color={danger ? 'red' : undefined} loading={loading} disabled={needsReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
