import { Badge, Stack, Text } from '@chakra-ui/react';
import { SectionHeader, type DataColumn, type RowAction } from '@team6083/ui';
import { Button } from '@chakra-ui/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import type { CostEntry, VendorOrder } from '../../api/types';
import { useDeleteCostEntry, useVoidCostEntry } from '../../api/vendorOrders';
import { DataTable } from '../../components/DataTable';
import { ReasonModal } from '../../components/ReasonModal';
import { formatMoney } from '../money';
import { CostEntryModal } from './CostEntryModal';
import { entryNumbers, isDerived } from './costEntries';

interface Props {
  order: VendorOrder;
  baseCurrency: string;
  baseDigits: number;
  teamName: (id: string) => string;
  canWrite: boolean;
  headingAs: 'h2' | 'h3';
}

/**
 * The "costs and adjustments" table (spec section 17.2): every amount on the order besides the goods. Rows are
 * numbered like the server's `entryNo`, so the reasons under the calculation can point at a row.
 */
export function CostEntriesTable({ order, baseCurrency, baseDigits, teamName, canWrite, headingAs }: Props) {
  const { t, i18n } = useTranslation('purchasing');
  const [form, setForm] = useState<CostEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CostEntry | null>(null);
  const [voiding, setVoiding] = useState<CostEntry | null>(null);
  const del = useDeleteCostEntry(order.id);
  const voidEntry = useVoidCostEntry(order.id);
  const numbers = entryNumbers(order.costEntries);
  const draft = order.status === 'draft';
  const placed = order.status === 'placed';
  const editable = canWrite && (draft || placed);
  const lineNo = (id: string) => order.lines.find((l) => l.id === id)?.lineNo;

  const strike = (e: CostEntry, node: ReactNode) => (e.voided ? <Text as="span" textDecoration="line-through" color="fg.muted">{node}</Text> : node);
  const splitTo = (e: CostEntry) => {
    const a = e.allocation;
    if (a.mode === 'teams') return `${t('costs.modes.teams')}: ${(a.teamIds ?? []).map(teamName).join(', ')}`;
    if (a.mode === 'lines') return `${t('costs.modes.lines')}: ${(a.lineIds ?? []).map((id) => `#${lineNo(id) ?? '?'}`).join(', ')}`;
    if (a.mode === 'manual') return (a.amounts ?? []).map((x) => `#${lineNo(x.lineId) ?? '?'}: ${formatMoney(x.amount, e.currency, i18n.language)}`).join('; ');
    return t('costs.modes.all');
  };

  const columns: DataColumn<CostEntry>[] = [
    { key: 'no', header: '#', numeric: true, cell: (e) => strike(e, numbers.get(e.id) ?? '—') },
    {
      key: 'type', header: t('costs.type'), priority: 'primary',
      cell: (e) => (
        <Stack gap="0">
          {strike(e, t(`costs.types.${e.type}`))}
          {e.voided && <Badge alignSelf="flex-start" variant="subtle">{t('costs.voided')}</Badge>}
          {e.source !== 'manual' && <Text textStyle="xs" color="fg.muted">{t(`costs.source.${e.source}`)}</Text>}
        </Stack>
      ),
    },
    { key: 'settlement', header: t('costs.settlement'), cell: (e) => strike(e, t(`costs.settlements.${e.settlement}`)) },
    { key: 'currency', header: t('costs.currency'), cell: (e) => strike(e, e.currency) },
    { key: 'amount', header: t('costs.amountShort'), numeric: true, cell: (e) => strike(e, formatMoney(e.amount, e.currency, i18n.language)) },
    {
      key: 'actual', header: t('costs.actualBaseShort', { currency: baseCurrency }), numeric: true,
      cell: (e) => {
        if (e.settlement !== 'separate') return '—';
        if (e.currency === baseCurrency) return strike(e, formatMoney(e.amount, baseCurrency, i18n.language));
        return strike(e, e.actualAmountBase ? formatMoney(e.actualAmountBase, baseCurrency, i18n.language) : <Badge variant="outline" colorPalette="orange">{t('provisional')}</Badge>);
      },
    },
    { key: 'method', header: t('costs.refundMethod'), cell: (e) => strike(e, e.refundMethod ? t(`costs.methods.${e.refundMethod}`) : '—') },
    { key: 'split', header: t('costs.splitTo'), cell: (e) => strike(e, splitTo(e)) },
    {
      key: 'note', header: t('costs.note'),
      cell: (e) => (
        <Stack gap="0">
          {strike(e, e.note || '—')}
          {e.voided && <Text textStyle="xs" color="fg.muted">{t('costs.voidedReason', { reason: e.voided.reason })}</Text>}
          {placed && !e.voided && isDerived(e) && <Text textStyle="xs" color="fg.muted">{t('costs.derivedHint')}</Text>}
        </Stack>
      ),
    },
  ];

  const rowActions = (e: CostEntry): RowAction[] => {
    const out: RowAction[] = [];
    if (e.voided) return out;
    out.push({ value: 'edit', icon: <LuPencil />, label: t('costs.edit'), onSelect: () => setForm(e) });
    if (draft) out.push({ value: 'delete', icon: <LuTrash2 />, label: t('costs.delete'), danger: true, onSelect: () => { del.reset(); setDeleting(e); } });
    // An entry of a problem resolution or a closure is voided by undoing that action.
    if (placed && !isDerived(e)) out.push({ value: 'void', icon: <LuBan />, label: t('costs.void'), danger: true, onSelect: () => { voidEntry.reset(); setVoiding(e); } });
    return out;
  };

  return (
    <Stack gap="2">
      <SectionHeader
        as={headingAs} mb="0" title={t('costs.title')} count={order.costEntries.length}
        actions={editable && <Button size="sm" variant="outline" onClick={() => setForm('new')}><LuPlus />{t('costs.add')}</Button>}
      />
      {order.costEntries.length === 0 ? (
        <Text color="fg.muted" textStyle="sm">{t('costs.empty')}</Text>
      ) : (
        <DataTable aria-label={t('costs.title')} rows={order.costEntries} columns={columns} getRowId={(e) => e.id} rowActions={editable ? rowActions : undefined} />
      )}
      <CostEntryModal
        order={order} teamName={teamName} baseDigits={baseDigits} entry={form && form !== 'new' ? form : null} open={form !== null} onClose={() => setForm(null)}
      />
      <ReasonModal
        open={!!deleting} danger title={t('costs.delete')} body={t('costs.deleteHelp')} confirmLabel={t('costs.delete')}
        loading={del.isPending} error={del.error} onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
      <ReasonModal
        open={!!voiding} danger title={t('costs.void')} body={t('costs.voidHelp')} confirmLabel={t('costs.void')} reasonLabel={t('undo.reason')}
        loading={voidEntry.isPending} error={voidEntry.error} onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidEntry.mutate({ entry: voiding, reason }, { onSuccess: () => setVoiding(null) })}
      />
    </Stack>
  );
}
