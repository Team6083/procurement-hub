import { Button, Dialog, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BlockerList, blockersOf } from './Blockers';
import { ErrorAlert } from './ErrorAlert';
import { AppDialog, DialogFooter } from './ui/dialog';
import { FormField } from './ui/field';
import { requiredText, useFieldError } from './ui/form';

interface Props {
  open: boolean;
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

const withReason = z.object({ reason: requiredText() });
const withoutReason = z.object({ reason: z.string() });

function Inner({ body, confirmLabel, danger, reasonLabel, loading, error, onConfirm }: Omit<Props, 'open' | 'title' | 'onClose'>) {
  const form = useForm({ resolver: zodResolver(reasonLabel ? withReason : withoutReason), defaultValues: { reason: '' } });
  const fieldError = useFieldError();
  const submit = form.handleSubmit((v) => onConfirm(v.reason.trim()));
  return (
    <>
      <Dialog.Body>
        <form id="reason-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            {body && <Text>{body}</Text>}
            {reasonLabel && (
              <FormField label={reasonLabel} required errorText={fieldError(form.formState.errors.reason)}>
                <Textarea autoresize rows={2} {...form.register('reason')} />
              </FormField>
            )}
            <BlockerList error={error} />
            {/* The list says it all; the generic "others depend on this" alert would only repeat it. */}
            {blockersOf(error).length === 0 && <ErrorAlert error={error} />}
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="reason-form" colorPalette={danger ? 'red' : undefined} loading={loading}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Confirmation dialog with an optional required reason/comment. */
export function ReasonModal({ open, title, onClose, ...rest }: Props) {
  return (
    <AppDialog open={open} onClose={onClose} title={title} size="sm">
      <Inner {...rest} />
    </AppDialog>
  );
}
