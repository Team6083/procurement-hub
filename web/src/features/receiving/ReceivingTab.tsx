import { Badge, Box, Button, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader, SelectionBar, type DataColumn } from '@team6083/ui';
import { DataTable } from '../../components/DataTable';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCircleAlert, LuPackageCheck, LuPackagePlus, LuWrench } from 'react-icons/lu';
import { useItemExceptionsOf, useRecordReceipt } from '../../api/receiving';
import type { Batch, Item, ItemException } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ItemStatusBadge } from '../batches/StatusBadges';
import type { Caller } from '../batches/rules';
import { shortDate } from '../dates';
import { ExceptionModal } from './ExceptionModal';
import { ReceiveModal } from './ReceiveModal';
import { ResolveModal, type Resolving } from './ResolveModal';
import { canReceive, canResolve, closedItems, openExceptionItems, remainingQuantity, toReceive } from './rules';

interface Props {
  batch: Batch;
  caller: Caller;
  items: Item[];
  nameOf: (id: string) => string;
}

export function ReceivingTab({ batch, caller, items, nameOf }: Props) {
  const { t } = useTranslation('receiving');
  const [receiving, setReceiving] = useState<Item | null>(null);
  const [reporting, setReporting] = useState<Item | null>(null);
  const [resolving, setResolving] = useState<Resolving | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkError, setBulkError] = useState<unknown>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const record = useRecordReceipt(batch.id);
  const mayReceive = canReceive(batch, caller);
  const mayResolve = canResolve(batch, caller);
  const pending = toReceive(items);
  const exceptions = openExceptionItems(items);
  const done = closedItems(items);
  const exceptionQs = useItemExceptionsOf(exceptions.map((i) => i.id));
  const openOf = new Map<string, ItemException | undefined>(exceptions.map((i, n) => [i.id, exceptionQs[n]?.data?.find((e) => e.resolution === null)]));
  const pickedItems = pending.filter((i) => picked.includes(i.id));

  // Each picked item gets one receipt for everything still to arrive, one after the other; a failure stops the run.
  const receiveInFull = async () => {
    setBulkError(null);
    setBulkRunning(true);
    try {
      for (const item of pickedItems) {
        await record.mutateAsync({ item, body: { quantity: remainingQuantity(item) } });
        setPicked((p) => p.filter((id) => id !== item.id));
      }
    } catch (e) {
      setBulkError(e);
    } finally {
      setBulkRunning(false);
    }
  };

  if (pending.length + exceptions.length + done.length === 0) {
    return <EmptyState icon={<LuPackageCheck />} title={t('empty')} description={t('emptyHelp')} />;
  }

  const nameCol: DataColumn<Item> = {
    key: 'name', header: t('table.item'), priority: 'primary',
    cell: (i) => (
      <>
        <Text as="span" color="fg.muted" fontWeight="normal" fontVariantNumeric="tabular-nums" me="1.5">#{i.seqNo}</Text>
        <Text as="span" overflowWrap="anywhere">{i.name}</Text>
      </>
    ),
  };
  const vendorCol: DataColumn<Item> = { key: 'vendor', header: t('table.vendor'), priority: 'secondary', cell: (i) => i.vendor || '—' };
  const receivedCol: DataColumn<Item> = {
    key: 'received', header: t('table.received'), numeric: true,
    cell: (i) => t('table.receivedOf', { received: i.receivedQuantity, quantity: i.quantity }),
  };
  const statusCol: DataColumn<Item> = { key: 'status', header: t('table.status'), cell: (i) => <ItemStatusBadge status={i.status} /> };

  return (
    <Stack gap="6">
      {exceptions.length > 0 && (
        <Stack gap="3">
          <SectionHeader title={t('groups.exceptions')} count={exceptions.length} mb="0" />
          <DataTable
            aria-label={t('groups.exceptions')}
            rows={exceptions}
            getRowId={(i) => i.id}
            rowActions={mayResolve ? (i) => {
              const open = openOf.get(i.id);
              return open ? [{ value: 'resolve', icon: <LuWrench />, label: t('exception.resolve'), onSelect: () => setResolving({ item: i, exception: open }) }] : [];
            } : undefined}
            columns={[
              nameCol,
              {
                key: 'problem', header: t('table.problem'),
                cell: (i) => {
                  const open = openOf.get(i.id);
                  if (!open) return <Skeleton h="5" w="32" rounded="l2" />;
                  return (
                    <Stack as="span" gap="0.5" textAlign="start">
                      <Badge variant="subtle" colorPalette="red" alignSelf={{ base: 'flex-end', md: 'flex-start' }}>{t(`exceptionType.${open.type}`)}</Badge>
                      <Text as="span" overflowWrap="anywhere" whiteSpace="pre-wrap">{open.description}</Text>
                      <Text as="span" color="fg.muted" textStyle="xs">{t('exception.reportedBy', { who: nameOf(open.reportedBy), when: shortDate(open.reportedAt) })}</Text>
                    </Stack>
                  );
                },
              },
              receivedCol,
            ]}
          />
        </Stack>
      )}
      <Stack gap="3">
        <SectionHeader title={t('groups.toReceive')} count={pending.length} mb="0" />
        <DataTable
          aria-label={t('groups.toReceive')}
          rows={pending}
          getRowId={(i) => i.id}
          selection={mayReceive ? { selected: picked, onChange: setPicked } : undefined}
          rowActions={mayReceive ? (i) => [
            { value: 'receive', icon: <LuPackagePlus />, label: t('receive.button', { count: remainingQuantity(i) }), onSelect: () => setReceiving(i) },
            { value: 'report', icon: <LuCircleAlert />, label: t('exception.button'), onSelect: () => setReporting(i) },
          ] : undefined}
          empty={<EmptyState icon={<LuPackageCheck />} title={t('allReceived')} />}
          columns={[nameCol, vendorCol, receivedCol, statusCol]}
        />
      </Stack>
      {done.length > 0 && (
        <Stack gap="3">
          <SectionHeader title={t('groups.done')} count={done.length} mb="0" />
          <DataTable
            aria-label={t('groups.done')}
            rows={done}
            getRowId={(i) => i.id}
            columns={[
              nameCol,
              vendorCol,
              receivedCol,
              statusCol,
              { key: 'reason', header: t('table.closeReason'), cell: (i) => i.closeReason || '—' },
            ]}
          />
        </Stack>
      )}
      <SelectionBar count={pickedItems.length} onClear={() => setPicked([])}>
        {bulkError ? <Box w="full"><ErrorAlert error={bulkError} /></Box> : null}
        <Button size="sm" loading={bulkRunning} onClick={() => void receiveInFull()}>{t('receive.inFull')}</Button>
      </SelectionBar>
      <ReceiveModal item={receiving} batchId={batch.id} nameOf={nameOf} onClose={() => setReceiving(null)} />
      <ExceptionModal item={reporting} batchId={batch.id} onClose={() => setReporting(null)} />
      <ResolveModal target={resolving} batchId={batch.id} onClose={() => setResolving(null)} />
    </Stack>
  );
}
