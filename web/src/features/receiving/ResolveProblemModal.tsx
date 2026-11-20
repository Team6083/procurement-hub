import { Button, Dialog, NativeSelect, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBaseCurrency } from '../../api/meta';
import { z } from 'zod';
import { useResolveProblem } from '../../api/deliveries';
import type { Problem, ProblemAction } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { RefundFields, checkRefundAmount, refundBody, refundDefaults, refundShape } from '../orders/RefundFields';

const ACTIONS = ['exchange', 'return_no_replace', 'accept'] as const satisfies readonly ProblemAction[];

// The refund only counts (and is only checked) for a return without replacement.
const resolveSchema = (baseDigits: number) => z.object({
  action: z.enum(ACTIONS),
  note: z.string(),
  ...refundShape(baseDigits),
}).superRefine((v, ctx) => {
  if (v.action === 'return_no_replace') checkRefundAmount(v, ctx);
});

function Form({ problem, baseDigits, onClose }: { problem: Problem; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  const baseCurrency = useBaseCurrency();
  const resolve = useResolveProblem();
  const form = useForm({ resolver: zodResolver(resolveSchema(baseDigits)), defaultValues: { action: 'exchange' as ProblemAction, note: '', ...refundDefaults(baseCurrency) } });
  const refundCurrency = useWatch({ control: form.control, name: 'refundCurrency' });
  const action = useWatch({ control: form.control, name: 'action' });
  const withRefund = action === 'return_no_replace';
  const submit = form.handleSubmit((v) =>
    resolve.mutate({ problem, action: v.action, refund: v.action === 'return_no_replace' ? refundBody(v, baseCurrency) : null, note: v.note.trim() }, { onSuccess: onClose }),
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
              <FormField label={t('problem.action')} helperText={t(`problem.actionHelp.${field.value}`)}>
                <NativeSelect.Root size="md">
                  <NativeSelect.Field
                    name={field.name}
                    value={field.value ?? ''}
                    onChange={(e) => e.currentTarget.value && field.onChange(e.currentTarget.value)}
                    onBlur={field.onBlur}
                  >
                    {!field.value && <option value="" />}
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>{t(`problem.actions.${a}`)}</option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            )} />
            {withRefund && (
              <FormProvider {...form}>
                <RefundFields currency={refundCurrency} baseCurrency={baseCurrency} />
              </FormProvider>
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
