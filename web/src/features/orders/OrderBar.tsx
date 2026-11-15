import { Box, Button, Input, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateOrder } from '../../api/orders';
import type { Batch, Item } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import type { Caller } from '../batches/rules';
import { MAX_VENDOR_LENGTH, canCreateOrder, commonVendor } from './rules';

interface Props {
  batch: Batch;
  caller: Caller;
  /** Approved, not-yet-ordered items among the selected rows: only these go into the order. */
  selected: Item[];
  /** Called after the order was created, to clear the selection. */
  onDone: () => void;
}

/**
 * Creates a team order from the selected approved items, inside the items' SelectionBar; the vendor defaults to
 * the items' common vendor. Renders nothing for a non-purchaser or when no orderable item is picked.
 */
export function OrderBar({ batch, caller, selected, onDone }: Props) {
  const { t } = useTranslation('orders');
  const createOrder = useCreateOrder(batch.id);
  const [typedVendor, setTypedVendor] = useState<string | undefined>();
  const vendor = typedVendor ?? commonVendor(selected.map((i) => i.vendor));

  if (!canCreateOrder(batch, caller) || selected.length === 0) return null;

  const submit = () =>
    createOrder.mutate(
      { vendor: vendor.trim(), itemIds: selected.map((i) => i.id) },
      { onSuccess: () => { onDone(); setTypedVendor(undefined); } },
    );

  return (
    <>
      {createOrder.error && <Box w="full"><ErrorAlert error={createOrder.error} /></Box>}
      <Input size="sm" w={{ base: 'full', sm: '56' }} aria-label={t('create.vendor')} placeholder={t('create.vendor')} value={vendor} maxLength={MAX_VENDOR_LENGTH}
        onChange={(e) => setTypedVendor(e.currentTarget.value)} />
      {vendor.trim() === '' ? <Text textStyle="sm" color="fg.muted">{t('create.needVendor')}</Text> : (
        <Button size="sm" loading={createOrder.isPending} onClick={submit}>
          {t('create.submit', { count: selected.length })}
        </Button>
      )}
    </>
  );
}
