import { Button, Dialog, Input, Stack, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCloseLine } from '../../api/vendorOrders';
import type { VendorOrderLine } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { validateAmount } from '../money';

function Form({ orderId, line, baseDigits, onClose }: { orderId: string; line: VendorOrderLine; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  const close = useCloseLine(orderId);
  const [type, setType] = useState<'short_accepted' | 'not_obtained'>('short_accepted');
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const refundError = refund.trim() ? validateAmount(refund, { digits: baseDigits, sign: 'nonNegative', nonZero: true }) : null;
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <SelectField
            label={t('close.type')} value={type} onChange={(v) => setType(v as typeof type)}
            options={[{ value: 'short_accepted', label: t('close.short_accepted') }, { value: 'not_obtained', label: t('close.not_obtained') }]}
          />
          <FormField label={t('undo.reason')} required><Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoresize rows={2} /></FormField>
          <FormField label={t('close.refund')} helperText={t('close.refundHelp')} errorText={refundError ? t(`amount.${refundError}`) : undefined}>
            <Input value={refund} inputMode="decimal" onChange={(e) => setRefund(e.currentTarget.value)} />
          </FormField>
          <ErrorAlert error={close.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button
          size="sm" colorPalette="red" loading={close.isPending} disabled={!reason.trim() || !!refundError}
          onClick={() => close.mutate({ line, type, reason: reason.trim(), refundBase: refund.trim() || null }, { onSuccess: onClose })}
        >
          {t('close.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Close the missing quantity of a short line (accept the shortage or cancel the rest), optionally with a refund. */
export function CloseLineModal({ orderId, line, baseDigits, onClose }: { orderId: string; line: VendorOrderLine | null; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={!!line} onClose={onClose} title={t('close.title')}>
      {line && <Form orderId={orderId} line={line} baseDigits={baseDigits} onClose={onClose} />}
    </AppDialog>
  );
}
