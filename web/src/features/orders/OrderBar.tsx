import { Button, Flex, Input, Stack, Text } from '@chakra-ui/react';
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

/** Creates a team order from the selected approved items; the vendor defaults to the items' common vendor. */
export function OrderBar({ batch, caller, selected, onDone }: Props) {
  const { t } = useTranslation('orders');
  const createOrder = useCreateOrder(batch.id);
  const [typedVendor, setTypedVendor] = useState<string | undefined>();
  const vendor = typedVendor ?? commonVendor(selected.map((i) => i.vendor));

  if (!canCreateOrder(batch, caller)) return null;

  const submit = () =>
    createOrder.mutate(
      { vendor: vendor.trim(), itemIds: selected.map((i) => i.id) },
      { onSuccess: () => { onDone(); setTypedVendor(undefined); } },
    );

  return (
    <Stack gap="3">
      <Flex gap="3" align="flex-end" wrap="wrap">
        <Stack gap="1" minW="64">
          <Text textStyle="sm" fontWeight="medium">{t('create.vendor')}</Text>
          <Input aria-label={t('create.vendor')} value={vendor} maxLength={MAX_VENDOR_LENGTH} onChange={(e) => setTypedVendor(e.currentTarget.value)} />
        </Stack>
        <Button disabled={selected.length === 0 || vendor.trim() === ''} loading={createOrder.isPending} onClick={submit}>
          {t('create.submit', { count: selected.length })}
        </Button>
      </Flex>
      <ErrorAlert error={createOrder.error} />
    </Stack>
  );
}
