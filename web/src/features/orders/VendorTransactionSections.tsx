import { Button, Card, Flex, HStack, IconButton, Input, SimpleGrid, Stack, Table, Text, Textarea } from '@chakra-ui/react';
import { SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import { usePatchVendorTransaction } from '../../api/orders';
import type { OrderDetail, SharedCost, VendorTransactionView } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { TableShell } from '../../components/ui/table';
import { format, parseDecSafe } from '../batches/decimal';
import { toLocalInput } from '../batches/datetime';
import { currencyFractionDigits } from '../money';
import { useAmountError } from './OrderBadges';
import { MAX_REASON_LENGTH } from './rules';
import {
  SHARED_COST_TYPES, allocationRequests, checkAllocations, detailsPatch, detailsToForm, itemPriceRequests, sharedCostRequests, sharedCostsTotal,
  type DetailsForm, type SharedCostRow,
} from './vendorTransaction';

interface SectionProps {
  view: VendorTransactionView;
  editable: boolean;
  /** Label of an order, e.g. "Batch #3 / order #1". */
  orderLabel: (o: OrderDetail['order']) => string;
}

/** Shows a validated section's mutation error and keeps the card's single solid button last. */
function CardActions({ error, children }: { error: unknown; children: React.ReactNode }) {
  return (
    <>
      <ErrorAlert error={error} />
      <HStack justify="flex-end">{children}</HStack>
    </>
  );
}

export function DetailsCard({ view, editable, base }: Pick<SectionProps, 'view' | 'editable'> & { base: string }) {
  const { t } = useTranslation('orders');
  const patch = usePatchVendorTransaction(view.id);
  const amountText = useAmountError();
  const [form, setForm] = useState<DetailsForm>(() => detailsToForm(view, toLocalInput));
  const check = detailsPatch(form, view, base ? currencyFractionDigits(base) : undefined);
  const set = (k: keyof DetailsForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card.Root size="sm">
      <Card.Body gap="4">
        <SectionHeader title={t('vt.details')} as="h3" mb="0" />
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
          <FormField label={t('create.vendor')} disabled={!editable} errorText={form.vendor.trim() === '' ? t('validation.required') : undefined}>
            <Input value={form.vendor} maxLength={200} onChange={(e) => set('vendor')(e.currentTarget.value)} />
          </FormField>
          <FormField label={t('external.orderNo')} disabled={!editable}>
            <Input value={form.externalOrderNo} maxLength={200} onChange={(e) => set('externalOrderNo')(e.currentTarget.value)} />
          </FormField>
          <FormField label={t('vt.expectedDelivery')} disabled={!editable}>
            <Input type="datetime-local" value={form.expectedDelivery} onChange={(e) => set('expectedDelivery')(e.currentTarget.value)} />
          </FormField>
          <FormField label={t('vt.charged', { currency: base })} helperText={t('vt.chargedHelp')} disabled={!editable} errorText={amountText(check.charged)}>
            <Input inputMode="decimal" value={form.chargedAmountBase} onChange={(e) => set('chargedAmountBase')(e.currentTarget.value)} />
          </FormField>
        </SimpleGrid>
        <FormField label={t('vt.paymentNote')} disabled={!editable}>
          <Textarea autoresize rows={2} maxLength={2000} value={form.paymentNote} onChange={(e) => set('paymentNote')(e.currentTarget.value)} />
        </FormField>
        {editable && (
          <CardActions error={patch.error}>
            <Button loading={patch.isPending} disabled={!check.valid} onClick={() => patch.mutate(check.body)}>{t('common:actions.save')}</Button>
          </CardActions>
        )}
      </Card.Body>
    </Card.Root>
  );
}

const toRow = (c: SharedCost): SharedCostRow => ({ type: c.type, amount: c.amount, note: c.note });

export function SharedCostsCard({ view, editable }: Pick<SectionProps, 'view' | 'editable'>) {
  const { t } = useTranslation('orders');
  const patch = usePatchVendorTransaction(view.id);
  const amountText = useAmountError();
  const [rows, setRows] = useState<SharedCostRow[]>(() => view.sharedCosts.map(toRow));
  const check = sharedCostRequests(rows, currencyFractionDigits(view.currency));
  const total = sharedCostsTotal(rows);
  const update = (i: number, k: keyof SharedCostRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const dirty = JSON.stringify(rows.map((r) => ({ ...r, amount: r.amount.trim(), note: r.note.trim() }))) !== JSON.stringify(view.sharedCosts.map(toRow));
  return (
    <Card.Root size="sm">
      <Card.Body gap="4">
        <SectionHeader
          title={t('vt.sharedCosts')}
          as="h3"
          mb="0"
          actions={editable && (
            <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { type: 'shipping', amount: '', note: '' }])}>
              <LuPlus />
              {t('vt.addCost')}
            </Button>
          )}
        />
        {rows.length === 0 ? (
          <Text color="fg.muted">{t('vt.noSharedCosts')}</Text>
        ) : (
          <Stack gap="3">
            {rows.map((r, i) => (
              <Flex key={i} gap="3" align="flex-start" wrap="wrap">
                <SelectField size="md" label={t('vt.costType')} value={r.type} disabled={!editable} w="36"
                  onChange={(v) => update(i, 'type', v)} options={SHARED_COST_TYPES.map((k) => ({ value: k, label: t(`vt.costTypes.${k}`) }))} />
                <FormField label={t('vt.costAmount', { currency: view.currency })} disabled={!editable} errorText={amountText(check.errors[i])} w="40">
                  <Input inputMode="decimal" value={r.amount} onChange={(e) => update(i, 'amount', e.currentTarget.value)} />
                </FormField>
                <FormField label={t('vt.costNote')} disabled={!editable} flex="1">
                  <Input value={r.note} maxLength={500} onChange={(e) => update(i, 'note', e.currentTarget.value)} />
                </FormField>
                {editable && (
                  <IconButton aria-label={t('vt.removeCost')} variant="ghost" colorPalette="red" mt="6" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <LuTrash2 />
                  </IconButton>
                )}
              </Flex>
            ))}
          </Stack>
        )}
        <Text fontWeight="semibold">{t('vt.sharedTotal', { amount: format(total), currency: view.currency })}</Text>
        {editable && (
          <CardActions error={patch.error}>
            <Button loading={patch.isPending} disabled={!check.valid || !dirty} onClick={() => patch.mutate({ sharedCosts: check.value })}>{t('common:actions.save')}</Button>
          </CardActions>
        )}
      </Card.Body>
    </Card.Root>
  );
}

export function AllocationCard({ view, editable, orderLabel }: SectionProps) {
  const { t } = useTranslation('orders');
  const patch = usePatchVendorTransaction(view.id);
  const amountText = useAmountError();
  const stored = Object.fromEntries(view.orders.map((d) => [d.order.id, view.allocations.find((a) => a.orderId === d.order.id)?.shareOfSharedCosts ?? '0']));
  const [shares, setShares] = useState<Record<string, string>>(stored);
  const [reason, setReason] = useState(view.allocationOverrideReason);
  const total = sharedCostsTotal(view.sharedCosts);
  const check = checkAllocations(shares, stored, total, currencyFractionDigits(view.currency));
  const overridden = view.allocations.some((a) => a.overridden);
  const needsReason = check.changed && reason.trim() === '';
  return (
    <Card.Root size="sm">
      <Card.Body gap="4">
        <SectionHeader title={t('vt.allocation')} as="h3" mb="0" />
        <Text color="fg.muted">{overridden ? t('vt.allocationOverridden') : t('vt.allocationProportional')}</Text>
        <TableShell minW="480px">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t('orders.number')}</Table.ColumnHeader>
              <Table.ColumnHeader w="48">{t('vt.share', { currency: view.currency })}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {view.orders.map(({ order }) => (
              <Table.Row key={order.id}>
                <Table.Cell>{orderLabel(order)}</Table.Cell>
                <Table.Cell>
                  <FormField disabled={!editable} errorText={amountText(check.errors[order.id])}>
                    <Input aria-label={t('vt.shareOf', { order: orderLabel(order) })} inputMode="decimal" value={shares[order.id] ?? ''}
                      onChange={(e) => setShares((s) => ({ ...s, [order.id]: e.currentTarget.value }))} />
                  </FormField>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </TableShell>
        <Text color={check.matches ? undefined : 'fg.error'} fontWeight="semibold">
          {t('vt.shareSum', { sum: format(check.sum), total: format(total), currency: view.currency })}
        </Text>
        <FormField label={t('vt.overrideReason')} helperText={t('vt.overrideHelp')} disabled={!editable} errorText={needsReason ? t('validation.required') : undefined}>
          <Textarea autoresize rows={2} maxLength={MAX_REASON_LENGTH} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        </FormField>
        {editable && (
          <CardActions error={patch.error}>
            {overridden && (
              <Button variant="outline" loading={patch.isPending && patch.variables?.allocations === null} onClick={() => patch.mutate({ allocations: null })}>{t('vt.resetAllocation')}</Button>
            )}
            <Button loading={patch.isPending && patch.variables?.allocations !== null} disabled={!check.valid || !check.changed || needsReason}
              onClick={() => patch.mutate({ allocations: allocationRequests(shares), allocationOverrideReason: reason.trim() })}>
              {t('common:actions.save')}
            </Button>
          </CardActions>
        )}
      </Card.Body>
    </Card.Root>
  );
}

export function ItemPricesCard({ view, editable, orderLabel }: SectionProps) {
  const { t } = useTranslation('orders');
  const patch = usePatchVendorTransaction(view.id);
  const amountText = useAmountError();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const all = view.orders.flatMap((d) => d.items);
  const check = itemPriceRequests(edits, all, view.currency, currencyFractionDigits(view.currency));
  return (
    <Card.Root size="sm">
      <Card.Body gap="4">
        <SectionHeader title={t('vt.prices')} as="h3" mb="0" />
        {view.orders.map(({ order, items }) => (
          <Stack key={order.id} gap="2">
            <Text fontWeight="semibold">{orderLabel(order)}</Text>
            <TableShell minW="720px">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t('vt.item')}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t('vt.quantity')}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t('vt.estimated')}</Table.ColumnHeader>
                  <Table.ColumnHeader w="48">{t('vt.actualUnit', { currency: view.currency })}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t('vt.actualCost')}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((it) => (
                  <Table.Row key={it.id}>
                    <Table.Cell>#{it.seqNo} {it.name}</Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{it.quantity}</Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{format(parseDecSafe(it.estimatedUnitPrice.amount))} {it.estimatedUnitPrice.currency}</Table.Cell>
                    <Table.Cell>
                      <FormField disabled={!editable} errorText={amountText(check.byItem[it.id])}>
                        <Input aria-label={t('vt.actualUnitOf', { item: it.name })} inputMode="decimal" value={edits[it.id] ?? it.actualUnitPrice?.amount ?? ''}
                          onChange={(e) => { const v = e.currentTarget.value; setEdits((s) => ({ ...s, [it.id]: v })); }} />
                      </FormField>
                    </Table.Cell>
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">{it.actualCostBase ? format(parseDecSafe(it.actualCostBase)) : '—'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </TableShell>
          </Stack>
        ))}
        {editable && (
          <CardActions error={patch.error}>
            <Button loading={patch.isPending} disabled={check.value.length === 0 || !check.valid}
              onClick={() => patch.mutate({ itemPrices: check.value }, { onSuccess: () => setEdits({}) })}>
              {t('common:actions.save')}
            </Button>
          </CardActions>
        )}
      </Card.Body>
    </Card.Root>
  );
}
