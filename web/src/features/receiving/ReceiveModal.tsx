import { Button, HStack, Input, List, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useItemReceipts, useRecordReceipt } from '../../api/receiving';
import type { Item } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { MAX_RECEIPT_NOTE, checkReceipt, remainingQuantity } from './rules';

interface Props {
  item: Item | null;
  batchId: string;
  nameOf: (id: string) => string;
  onClose: () => void;
}

function Inner({ item, batchId, nameOf, onClose }: Props & { item: Item }) {
  const { t } = useTranslation('receiving');
  const remaining = remainingQuantity(item);
  const record = useRecordReceipt(batchId);
  const receipts = useItemReceipts(item.id);
  const [quantity, setQuantity] = useState(String(remaining));
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const check = checkReceipt(quantity, note, remaining);
  return (
    <Stack gap="4">
      <Text color="fg.muted">{t('receive.progress', { received: item.receivedQuantity, quantity: item.quantity })}</Text>
      <FormField label={t('receive.quantity')} helperText={t('receive.remaining', { count: remaining })} errorText={touched && check.quantityError ? t(`validation.quantity.${check.quantityError}`, { max: remaining }) : undefined}>
        <Input size="lg" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.currentTarget.value)} onBlur={() => setTouched(true)} />
      </FormField>
      <FormField label={t('receive.note')} errorText={check.noteTooLong ? t('validation.noteTooLong') : undefined}>
        <Textarea autoresize rows={2} maxLength={MAX_RECEIPT_NOTE} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      </FormField>
      {receipts.data && receipts.data.length > 0 && (
        <Stack gap="1">
          <Text textStyle="sm" fontWeight="medium">{t('receive.history')}</Text>
          <List.Root ps="4" color="fg.muted">
            {receipts.data.map((r) => (
              <List.Item key={r.id}>
                {t('receive.historyEntry', { quantity: r.quantity, who: nameOf(r.receivedBy), when: new Date(r.receivedAt).toLocaleString() })}
                {r.note && ` — ${r.note}`}
              </List.Item>
            ))}
          </List.Root>
        </Stack>
      )}
      <ErrorAlert error={record.error} />
      <HStack justify="flex-end">
        <Button size="lg" variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button size="lg" loading={record.isPending} disabled={!check.valid} onClick={() => record.mutate({ item, body: check.body }, { onSuccess: onClose })}>
          {t('receive.submit')}
        </Button>
      </HStack>
    </Stack>
  );
}

export function ReceiveModal(props: Props) {
  const { t } = useTranslation('receiving');
  return (
    <AppDialog open={!!props.item} onClose={props.onClose} title={t('receive.title', { name: props.item?.name })}>
      {props.item && <Inner {...props} item={props.item} />}
    </AppDialog>
  );
}
