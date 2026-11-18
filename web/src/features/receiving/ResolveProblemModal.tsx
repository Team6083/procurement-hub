import { Button, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBaseCurrency } from '../../api/meta';
import { z } from 'zod';
import { useResolveProblem } from '../../api/deliveries';
import type { Problem, ProblemAction } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { amountText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';

const ACTIONS = ['exchange', 'return_no_replace', 'accept'] as const satisfies readonly ProblemAction[];

// The refund only counts (and is only checked) for a return without replacement.
const resolveSchema = (baseDigits: number) => z.discriminatedUnion('action', [
  z.object({ action: z.literal('return_no_replace'), refund: amountText({ digits: baseDigits, sign: 'nonNegative', nonZero: true }, true), note: z.string() }),
  z.object({ action: z.enum(['exchange', 'accept']), refund: z.string(), note: z.string() }),
]);

function Form({ problem, baseDigits, onClose }: { problem: Problem; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  const baseCurrency = useBaseCurrency();
  const resolve = useResolveProblem();
  const form = useForm({ resolver: zodResolver(resolveSchema(baseDigits)), defaultValues: { action: 'exchange' as ProblemAction, refund: '', note: '' } });
  const action = useWatch({ control: form.control, name: 'action' });
  const fieldError = useFieldError();
  const withRefund = action === 'return_no_replace';
  const submit = form.handleSubmit((v) =>
    resolve.mutate({ problem, action: v.action, refundBase: v.action === 'return_no_replace' && v.refund.trim() ? v.refund.trim() : null, note: v.note.trim() }, { onSuccess: onClose }),
  );
  return (
    <>
      <Dialog.Body>
        <form id="resolve-problem-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Text>
              {t('problem.summary', { order: problem.vendorOrderNumber, n: problem.lineNo, name: problem.lineName, count: problem.quantity, type: t(`problemType.${problem.type}`) })}
            </Text>
            <Controller control={form.control} name="action" render={({ field }) => (
              <SelectField
                label={t('problem.action')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                helperText={t(`problem.actionHelp.${field.value}`)}
                options={ACTIONS.map((a) => ({ value: a, label: t(`problem.actions.${a}`) }))}
              />
            )} />
            {withRefund && (
              <FormField label={t('problem.refund', { currency: baseCurrency })} helperText={t('problem.refundHelp')} errorText={fieldError(form.formState.errors.refund)}>
                <Input inputMode="decimal" {...form.register('refund')} />
              </FormField>
            )}
            <FormField label={t('problem.note')}>
              <Textarea rows={2} autoresize {...form.register('note')} />
            </FormField>
            <ErrorAlert error={resolve.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="resolve-problem-form" loading={resolve.isPending}>{t('problem.resolve')}</Button>
      </DialogFooter>
    </>
  );
}

/** Settle an open problem: wait for an exchange, return without replacement (optionally refunded) or accept it as is. */
export function ResolveProblemModal({ problem, baseDigits, onClose }: { problem: Problem | null; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  return (
    <AppDialog open={!!problem} onClose={onClose} title={t('problem.resolve')}>
      {problem && <Form problem={problem} baseDigits={baseDigits} onClose={onClose} />}
    </AppDialog>
  );
}
