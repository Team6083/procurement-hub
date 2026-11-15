import { Button, HStack, Input, Stack, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useAddAdjustment } from '../../api/orders';
import type { Item, Order } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { currencyFractionDigits } from '../money';
import { checkAdjustment } from './adjustment';
import { useAmountError } from './OrderBadges';
import { MAX_REASON_LENGTH } from './rules';

interface Props {
  order: Order | null;
  batchId: string;
  items: Item[];
  onClose: () => void;
}

function Inner({ order, batchId, items, onClose }: Props & { order: Order }) {
  const { t } = useTranslation('orders');
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const add = useAddAdjustment(batchId);
  const amountText = useAmountError();
  const [form, setForm] = useState({ amountBase: '', reason: '', itemId: '' });
  const [touched, setTouched] = useState(false);
  const check = checkAdjustment(form, base ? currencyFractionDigits(base) : undefined);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const orderItems = items.filter((i) => order.itemIds.includes(i.id));
  return (
    <Stack gap="4">
      <FormField label={t('adjust.amount', { currency: base })} helperText={t('adjust.amountHelp')} errorText={touched ? amountText(check.amountError) : undefined}>
        <Input inputMode="decimal" value={form.amountBase} onChange={(e) => set('amountBase')(e.currentTarget.value)} onBlur={() => setTouched(true)} />
      </FormField>
      <FormField label={t('adjust.reason')} errorText={touched && check.reasonError ? t(`validation.reason.${check.reasonError}`) : undefined}>
        <Textarea autoresize rows={2} maxLength={MAX_REASON_LENGTH} value={form.reason} onChange={(e) => set('reason')(e.currentTarget.value)} onBlur={() => setTouched(true)} />
      </FormField>
      <SelectField size="md" label={t('adjust.item')} placeholder={t('adjust.wholeOrder')} value={form.itemId} onChange={set('itemId')}
        options={orderItems.map((i) => ({ value: i.id, label: `#${i.seqNo} ${i.name}` }))} />
      <ErrorAlert error={add.error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={add.isPending} disabled={!check.valid} onClick={() => add.mutate({ order, body: check.body }, { onSuccess: onClose })}>{t('adjust.submit')}</Button>
      </HStack>
    </Stack>
  );
}

export function AdjustmentModal(props: Props) {
  const { t } = useTranslation('orders');
  return (
    <AppDialog open={!!props.order} onClose={props.onClose} title={t('adjust.title', { number: props.order?.number })}>
      {props.order && <Inner {...props} order={props.order} />}
    </AppDialog>
  );
}
