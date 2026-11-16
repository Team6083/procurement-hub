import { Button, Card, Checkbox, HStack, IconButton, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuTrash2 } from 'react-icons/lu';
import { usePutOrder, type OrderBody } from '../../api/vendorOrders';
import type { Vendor, VendorOrder } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { add, format, parseDec, ZERO, type Dec } from '../batches/decimal';
import { currencyFractionDigits, validateAmount } from '../money';

const TYPES = ['shipping', 'fee', 'tax', 'discount', 'other'] as const;

interface Cost { type: string; amount: string; note: string }

function sum(costs: Cost[]): Dec {
  return costs.reduce((acc, c) => {
    try {
      return add(acc, parseDec(c.amount));
    } catch {
      return acc;
    }
  }, ZERO);
}

interface Props {
  order: VendorOrder;
  vendors: Vendor[];
  supported: string[];
  teamName: (id: string) => string;
  baseDigits: number;
}

/**
 * The editable order fields: vendor order number, shared costs, optional per-team allocation, the amount actually
 * charged, delivery date and note. PUT replaces them all, so the form always sends the whole set.
 */
export function DetailsForm({ order, vendors, supported, teamName, baseDigits }: Props) {
  const { t } = useTranslation('purchasing');
  const put = usePutOrder(order.id);
  const draft = order.status === 'draft';
  const [vendorId, setVendorId] = useState(order.vendorId);
  const [currency, setCurrency] = useState(order.currency);
  const [externalNo, setExternalNo] = useState(order.externalOrderNo);
  const [delivery, setDelivery] = useState(order.expectedDeliveryDate);
  const [note, setNote] = useState(order.paymentNote);
  const [charged, setCharged] = useState(order.chargedAmountBase ?? '');
  const [costs, setCosts] = useState<Cost[]>(order.sharedCosts.map((c) => ({ ...c })));
  const [byTeam, setByTeam] = useState(order.teamCostOverrides !== null);
  const [overrides, setOverrides] = useState<Record<string, string>>(Object.fromEntries((order.teamCostOverrides ?? []).map((o) => [o.teamId, o.amount])));
  const [reason, setReason] = useState(order.overrideReason);
  const digits = currencyFractionDigits(currency) ?? 2;
  const [saved, setSaved] = useState(false);

  const costErrors = costs.map((c) => validateAmount(c.amount, { digits, sign: 'any' }));
  const chargedError = charged.trim() ? validateAmount(charged, { digits: baseDigits }) : null;
  const overrideErrors = order.teamIds.map((id) => validateAmount(overrides[id] ?? '', { digits }));
  const overrideSum = order.teamIds.reduce((acc, id) => {
    try {
      return add(acc, parseDec(overrides[id] ?? ''));
    } catch {
      return acc;
    }
  }, ZERO);
  const mismatch = byTeam && format(overrideSum) !== format(sum(costs));
  const valid = !costErrors.some(Boolean) && !chargedError && (!byTeam || (!overrideErrors.some(Boolean) && !mismatch && !!reason.trim()));

  const body = (): OrderBody => ({
    vendorId, currency, externalOrderNo: externalNo.trim(), sharedCosts: costs.map((c) => ({ ...c, note: c.note.trim() })),
    teamCostOverrides: byTeam ? order.teamIds.map((id) => ({ teamId: id, amount: overrides[id] ?? '' })) : null,
    overrideReason: byTeam ? reason.trim() : '', chargedAmountBase: charged.trim() || null, expectedDeliveryDate: delivery, paymentNote: note.trim(),
  });
  const setCost = (i: number, patch: Partial<Cost>) => { setSaved(false); setCosts(costs.map((c, k) => (k === i ? { ...c, ...patch } : c))); };

  return (
    <Stack gap="2">
      <SectionHeader as="h3" title={t('details.title')} />
      <Card.Root size="sm">
        <Card.Body gap="4">
          {draft && (
            <HStack align="flex-start" wrap="wrap">
              <SelectField label={t('details.vendor')} value={vendorId} onChange={setVendorId} options={vendors.filter((v) => v.active || v.id === order.vendorId).map((v) => ({ value: v.id, label: v.name }))} />
              <SelectField label={t('details.currency')} value={currency} onChange={setCurrency} options={supported} />
            </HStack>
          )}
          <HStack align="flex-start" wrap="wrap">
            <FormField label={t('details.externalNo')} flex="1"><Input value={externalNo} onChange={(e) => { setSaved(false); setExternalNo(e.currentTarget.value); }} /></FormField>
            <FormField label={t('details.delivery')} flex="1"><Input type="date" value={delivery} onChange={(e) => { setSaved(false); setDelivery(e.currentTarget.value); }} /></FormField>
          </HStack>

          <Stack gap="2">
            <Text fontWeight="medium" fontSize="sm">{t('details.sharedCosts', { currency })}</Text>
            {costs.length === 0 && <Text fontSize="sm" color="fg.muted">{t('details.noSharedCosts')}</Text>}
            {costs.map((c, i) => (
              <HStack key={i} align="flex-start" wrap="wrap">
                <SelectField aria-label={t('details.costType')} value={c.type} onChange={(v) => setCost(i, { type: v })} options={TYPES.map((x) => ({ value: x, label: t(`details.costTypes.${x}`) }))} />
                <FormField errorText={c.amount && costErrors[i] ? t(`amount.${costErrors[i]}`) : undefined} flex="1">
                  <Input aria-label={t('details.costAmount')} placeholder={t('details.costAmount')} value={c.amount} inputMode="decimal" onChange={(e) => setCost(i, { amount: e.currentTarget.value })} />
                </FormField>
                <FormField flex="2"><Input aria-label={t('details.costNote')} placeholder={t('details.costNote')} value={c.note} onChange={(e) => setCost(i, { note: e.currentTarget.value })} /></FormField>
                <IconButton size="sm" variant="ghost" aria-label={t('details.removeCost')} onClick={() => { setSaved(false); setCosts(costs.filter((_, k) => k !== i)); }}><LuTrash2 /></IconButton>
              </HStack>
            ))}
            <div>
              <Button size="xs" variant="outline" onClick={() => { setSaved(false); setCosts([...costs, { type: 'shipping', amount: '', note: '' }]); }}><LuPlus />{t('details.addCost')}</Button>
            </div>
          </Stack>

          {order.teamIds.length > 1 && (
            <Stack gap="2">
              <Checkbox.Root checked={byTeam} onCheckedChange={(e) => { setSaved(false); setByTeam(!!e.checked); }}>
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{t('details.byTeam')}</Checkbox.Label>
              </Checkbox.Root>
              {byTeam && (
                <Stack gap="2">
                  {order.teamIds.map((id, i) => (
                    <FormField key={id} label={teamName(id)} errorText={overrides[id] && overrideErrors[i] ? t(`amount.${overrideErrors[i]}`) : undefined}>
                      <Input value={overrides[id] ?? ''} inputMode="decimal" onChange={(e) => { setSaved(false); setOverrides({ ...overrides, [id]: e.currentTarget.value }); }} />
                    </FormField>
                  ))}
                  {mismatch && <Text fontSize="sm" color="red.fg">{t('details.overrideMismatch', { total: format(sum(costs)), allocated: format(overrideSum) })}</Text>}
                  <FormField label={t('details.overrideReason')} required><Textarea value={reason} onChange={(e) => { setSaved(false); setReason(e.currentTarget.value); }} autoresize rows={2} /></FormField>
                </Stack>
              )}
            </Stack>
          )}

          <FormField label={t('details.charged')} helperText={t('details.chargedHelp')} errorText={chargedError ? t(`amount.${chargedError}`) : undefined}>
            <Input value={charged} inputMode="decimal" onChange={(e) => { setSaved(false); setCharged(e.currentTarget.value); }} />
          </FormField>
          <FormField label={t('details.paymentNote')}><Textarea value={note} onChange={(e) => { setSaved(false); setNote(e.currentTarget.value); }} autoresize rows={2} /></FormField>
          <ErrorAlert error={put.error} />
          {saved && <Notice status="info">{t('details.saved')}</Notice>}
          <HStack justify="flex-end">
            <Button loading={put.isPending} disabled={!valid} onClick={() => put.mutate(body(), { onSuccess: () => setSaved(true) })}>{t('common:actions.save')}</Button>
          </HStack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
