import { formatMoney, validateAmount } from '../money';
import { Badge, Button, Card, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { EmptyState, SectionHeader, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuReceipt, LuUndo2 } from 'react-icons/lu';
import { useAddLedger, useVoidLedger } from '../../api/vendorOrders';
import type { LedgerEntry, VendorOrder } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { UndoDialog } from '../../components/UndoDialog';

function AddForm({ order, baseDigits, onClose }: { order: VendorOrder; baseDigits: number; onClose: () => void }) {
  const { t } = useTranslation('purchasing');
  const add = useAddLedger(order.id);
  const [amount, setAmount] = useState('');
  const [lineId, setLineId] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const err = amount.trim() ? validateAmount(amount, { digits: baseDigits, sign: 'any', nonZero: true }) : 'format';
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <FormField label={t('ledger.amount')} helperText={t('ledger.amountHelp')} errorText={(amount.trim() || tried) && err ? t(`amount.${err}`) : undefined}>
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.currentTarget.value)} />
          </FormField>
          <SelectField
            label={t('ledger.line')} value={lineId} onChange={setLineId} placeholder={t('ledger.spread')}
            options={order.lines.map((l) => ({ value: l.id, label: `#${l.lineNo} ${l.name}` }))}
          />
          <FormField label={t('undo.reason')} required errorText={tried && !reason.trim() ? t('common:validation.required') : undefined}><Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoresize rows={2} /></FormField>
          <ErrorAlert error={add.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button
          size="sm" loading={add.isPending}
          onClick={() => {
            setTried(true);
            if (err || !reason.trim()) return;
            add.mutate({ amountBase: amount.trim(), vendorOrderLineId: lineId || null, reason: reason.trim() }, { onSuccess: onClose });
          }}
        >
          {t('ledger.add')}
        </Button>
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
        opened={!!voiding} title={t('ledger.void')} body={t('ledger.voidHelp')} confirmLabel={t('ledger.void')}
        loading={voidEntry.isPending} error={voidEntry.error} onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidEntry.mutate({ entryId: voiding.id, reason }, { onSuccess: () => setVoiding(null) })}
      />
    </Stack>
  );
}
