import { Button, HStack, Input, Stack } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchOrder } from '../../api/orders';
import type { Item, Order, PatchOrderRequest } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Checklist } from '../../components/ui/checklist';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { MAX_VENDOR_LENGTH, orderableItems } from './rules';

interface Props {
  order: Order | null;
  batchId: string;
  items: Item[];
  onClose: () => void;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function Inner({ order, batchId, items, onClose }: Props & { order: Order }) {
  const { t } = useTranslation('orders');
  const patch = usePatchOrder(batchId);
  const [vendor, setVendor] = useState(order.vendor);
  const [itemIds, setItemIds] = useState(order.itemIds);
  // The order's own items stay listed; others can be added while approved and in no live order.
  const options = items
    .filter((i) => order.itemIds.includes(i.id) || orderableItems([i]).length > 0)
    .map((i) => ({ value: i.id, label: `#${i.seqNo} ${i.name}` }));
  const body: PatchOrderRequest = {};
  if (vendor.trim() !== order.vendor) body.vendor = vendor.trim();
  if (!sameSet(itemIds, order.itemIds)) body.itemIds = itemIds;
  const valid = vendor.trim() !== '' && vendor.trim().length <= MAX_VENDOR_LENGTH && itemIds.length > 0 && Object.keys(body).length > 0;
  return (
    <Stack gap="4">
      <FormField label={t('create.vendor')}>
        <Input value={vendor} maxLength={MAX_VENDOR_LENGTH} onChange={(e) => setVendor(e.currentTarget.value)} />
      </FormField>
      <Checklist label={t('edit.items')} options={options} value={itemIds} onChange={setItemIds} emptyText={t('edit.noItems')} />
      <ErrorAlert error={patch.error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={patch.isPending} disabled={!valid} onClick={() => patch.mutate({ order, body }, { onSuccess: onClose })}>{t('common:actions.save')}</Button>
      </HStack>
    </Stack>
  );
}

export function EditOrderModal(props: Props) {
  const { t } = useTranslation('orders');
  return (
    <AppDialog open={!!props.order} onClose={props.onClose} title={t('edit.title', { number: props.order?.number })}>
      {props.order && <Inner {...props} order={props.order} />}
    </AppDialog>
  );
}
