import { Button, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolveProblem } from '../../api/deliveries';
import type { Problem, ProblemAction } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { validateAmount } from '../money';

const ACTIONS: ProblemAction[] = ['exchange', 'return_no_replace', 'accept'];

function Form({ problem, baseDigits, onClose }: { problem: Problem; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  const resolve = useResolveProblem();
  const [action, setAction] = useState<ProblemAction>('exchange');
  const [refund, setRefund] = useState('');
  const [note, setNote] = useState('');
  const withRefund = action === 'return_no_replace';
  const refundError = withRefund && refund.trim() ? validateAmount(refund, { digits: baseDigits, sign: 'nonNegative', nonZero: true }) : null;
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <Text>
            {t('problem.summary', { order: problem.vendorOrderNumber, n: problem.lineNo, name: problem.lineName, count: problem.quantity, type: t(`problemType.${problem.type}`) })}
          </Text>
          <SelectField
            label={t('problem.action')} value={action} onChange={(v) => setAction(v as ProblemAction)}
            helperText={t(`problem.actionHelp.${action}`)}
            options={ACTIONS.map((a) => ({ value: a, label: t(`problem.actions.${a}`) }))}
          />
          {withRefund && (
            <FormField label={t('problem.refund')} helperText={t('problem.refundHelp')} errorText={refundError ? t(`purchasing:amount.${refundError}`) : undefined}>
              <Input value={refund} inputMode="decimal" onChange={(e) => setRefund(e.currentTarget.value)} />
            </FormField>
          )}
          <FormField label={t('problem.note')}>
            <Textarea value={note} rows={2} autoresize onChange={(e) => setNote(e.currentTarget.value)} />
          </FormField>
          <ErrorAlert error={resolve.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button
          size="sm" loading={resolve.isPending} disabled={!!refundError}
          onClick={() => resolve.mutate({ problem, action, refundBase: withRefund && refund.trim() ? refund.trim() : null, note: note.trim() }, { onSuccess: onClose })}
        >
          {t('problem.resolve')}
        </Button>
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
