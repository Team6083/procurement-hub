import { formatMoney } from '../money';
import { Badge, Button, Card, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { EmptyState, SectionHeader, type DataColumn } from '@team6083/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LuPlus, LuReceipt, LuUndo2 } from 'react-icons/lu';
import { useAddLedger, useVoidLedger } from '../../api/vendorOrders';
import type { LedgerEntry, VendorOrder } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { amountText, requiredText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { UndoDialog } from '../../components/UndoDialog';

const addSchema = (baseDigits: number) => z.object({
  amount: amountText({ digits: baseDigits, sign: 'any', nonZero: true }),
  lineId: z.string(),
  reason: requiredText(),
});

function AddForm({ order, baseDigits, onClose }: { order: VendorOrder; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  const add = useAddLedger(order.id);
  const form = useForm({ resolver: zodResolver(addSchema(baseDigits)), defaultValues: { amount: '', lineId: '', reason: '' } });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => add.mutate({ amountBase: v.amount.trim(), vendorOrderLineId: v.lineId || null, reason: v.reason.trim() }, { onSuccess: onClose }));
  return (
    <>
      <Dialog.Body>
        <form id="ledger-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('ledger.amount')} required helperText={t('ledger.amountHelp')} errorText={fieldError(err.amount)}>
              <Input inputMode="decimal" {...form.register('amount')} />
            </FormField>
            <Controller control={form.control} name="lineId" render={({ field }) => (
              <SelectField
                label={t('ledger.line')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} placeholder={t('ledger.spread')}
                options={order.lines.map((l) => ({ value: l.id, label: `#${l.lineNo} ${l.name}` }))}
              />
            )} />
            <FormField label={t('undo.reason')} required errorText={fieldError(err.reason)}>
              <Textarea autoresize rows={2} {...form.register('reason')} />
            </FormField>
            <ErrorAlert error={add.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="ledger-form" loading={add.isPending}>{t('ledger.add')}</Button>
      </DialogFooter>
    </>
  );
}

/** Adjustments after placing (refunds negative); voiding is an undo with a reason. */
export function LedgerSection({ order, baseCurrency, baseDigits, canWrite, headingAs = 'h2' }: { order: VendorOrder; baseCurrency: string; baseDigits: number; canWrite: boolean; headingAs?: 'h2' | 'h3' }) {
  const { t, i18n } = useTranslation('purchasing');
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<LedgerEntry | null>(null);
  const voidEntry = useVoidLedger(order.id);
  if (order.status !== 'placed' && order.ledger.length === 0) return null;
  const lineLabel = (id: string | null) => {
    const l = order.lines.find((x) => x.id === id);
    return l ? `#${l.lineNo} ${l.name}` : t('ledger.spread');
  };
  const columns: DataColumn<LedgerEntry>[] = [
    { key: 'amount', header: t('ledger.amount'), numeric: true, priority: 'primary', cell: (e) => formatMoney(e.amountBase, baseCurrency, i18n.language) },
    { key: 'reason', header: t('undo.reason'), cell: (e) => e.reason },
    { key: 'line', header: t('ledger.line'), priority: 'secondary', cell: (e) => lineLabel(e.vendorOrderLineId) },
    {
      key: 'status', header: t('ledger.status'),
      cell: (e) => (e.voided ? <Badge variant="outline">{t('ledger.voided')}</Badge> : e.source === 'manual' ? null : <Badge variant="subtle">{t(`ledger.source.${e.source}`)}</Badge>),
    },
  ];
  return (
    <Stack gap="2">
      <SectionHeader
        as={headingAs} mb="0" title={t('ledger.title')} count={order.ledger.length}
        actions={canWrite && order.status === 'placed' && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><LuPlus />{t('ledger.add')}</Button>
        )}
      />
      <DataTable
        aria-label={t('ledger.title')} rows={order.ledger} columns={columns} getRowId={(e) => e.id}
        rowActions={canWrite && order.status === 'placed'
          ? (e) => (!e.voided ? [{ value: 'void', icon: <LuUndo2 />, label: t('ledger.void'), danger: true, onSelect: () => { voidEntry.reset(); setVoiding(e); } }] : [])
          : undefined}
        empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuReceipt />} title={t('ledger.empty')} /></Card.Body></Card.Root>}
      />
      {order.ledger.some((e) => e.voided) && <Text textStyle="xs" color="fg.muted">{t('ledger.voidedHint')}</Text>}
      <AppDialog open={adding} onClose={() => setAdding(false)} title={t('ledger.add')}>
        <AddForm order={order} baseDigits={baseDigits} onClose={() => setAdding(false)} />
      </AppDialog>
      <UndoDialog
        open={!!voiding} title={t('ledger.void')} body={t('ledger.voidHelp')} confirmLabel={t('ledger.void')}
        loading={voidEntry.isPending} error={voidEntry.error} onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidEntry.mutate({ entryId: voiding.id, reason }, { onSuccess: () => setVoiding(null) })}
      />
    </Stack>
  );
}
