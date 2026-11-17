import { Button, Dialog, Input, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
import { deadlineInput, toLocalInput } from './datetime';

interface Props {
  open: boolean;
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

function Inner({ title, required, initial, loading, error, reasonLabel, onConfirm }: Omit<Props, 'open' | 'onClose'>) {
  const schema = z.object({
    deadline: deadlineInput(required),
    reason: reasonLabel ? z.string().trim().min(1, 'common:validation.required') : z.string(),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { deadline: toLocalInput(initial), reason: '' } });
  const fieldError = useFieldError();
  const { t } = useTranslation('batches');
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => onConfirm(v.deadline ?? undefined, v.reason.trim()));
  return (
    <>
      <Dialog.Body>
        <form id="deadline-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('header.deadline')} required={required} helperText={required ? t('actions.deadlineRequired') : t('actions.deadlineOptional')} errorText={fieldError(err.deadline)}>
              <Input type="datetime-local" {...form.register('deadline')} />
            </FormField>
            {reasonLabel && (
              <FormField label={reasonLabel} required errorText={fieldError(err.reason)}>
                <Textarea autoresize rows={2} {...form.register('reason')} />
              </FormField>
            )}
            <ErrorAlert error={error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="deadline-form" loading={loading}>{title}</Button>
      </DialogFooter>
    </>
  );
}

export function DeadlineModal({ open, ...rest }: Props) {
  return (
    <AppDialog open={open} onClose={rest.onClose} title={rest.title} size="sm">
      <Inner {...rest} />
    </AppDialog>
  );
}
