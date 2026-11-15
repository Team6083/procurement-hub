import { Button, HStack, Input, Stack } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMeta } from '../../api/meta';
import { useCreateVendorTransaction } from '../../api/orders';
import type { Item, Order } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { paths } from '../../paths';
import { MAX_VENDOR_LENGTH, commonVendor, defaultCurrency } from './rules';

interface Props {
  opened: boolean;
  orders: Order[];
  items: Item[];
  onClose: () => void;
}

function Inner({ orders, items, onClose }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('orders');
  const meta = useMeta();
  const navigate = useNavigate();
  const create = useCreateVendorTransaction();
  const currencies = meta.data?.supportedCurrencies ?? [];
  const ids = orders.flatMap((o) => o.itemIds);
  const [currency, setCurrency] = useState(() => defaultCurrency(items.filter((i) => ids.includes(i.id)), meta.data?.baseCurrency ?? ''));
  const common = commonVendor(orders.map((o) => o.vendor));
  const [vendor, setVendor] = useState(common);
  const [externalOrderNo, setNo] = useState('');
  const valid = currency !== '' && vendor.trim() !== '' && vendor.length <= MAX_VENDOR_LENGTH;
  const submit = () =>
    create.mutate(
      { orderIds: orders.map((o) => o.id), currency, vendor: vendor.trim(), ...(externalOrderNo.trim() ? { externalOrderNo: externalOrderNo.trim() } : {}) },
      { onSuccess: (v) => { onClose(); void navigate(paths.vendorTransaction(v.id)); } },
    );
  return (
    <Stack gap="4">
      <SelectField size="md" label={t('external.currency')} helperText={t('external.currencyHelp')} value={currency} onChange={setCurrency} options={currencies} />
      <FormField label={t('create.vendor')} helperText={common ? undefined : t('external.vendorDiffers')}>
        <Input value={vendor} maxLength={MAX_VENDOR_LENGTH} onChange={(e) => setVendor(e.currentTarget.value)} />
      </FormField>
      <FormField label={t('external.orderNo')}>
        <Input value={externalOrderNo} maxLength={MAX_VENDOR_LENGTH} onChange={(e) => setNo(e.currentTarget.value)} />
      </FormField>
      <ErrorAlert error={create.error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={create.isPending} disabled={!valid} onClick={submit}>{t('external.create')}</Button>
      </HStack>
    </Stack>
  );
}

export function ExternalOrderModal({ opened, ...rest }: Props) {
  const { t } = useTranslation('orders');
  return (
    <AppDialog open={opened} onClose={rest.onClose} title={t('external.title', { count: rest.orders.length })}>
      <Inner {...rest} />
    </AppDialog>
  );
}
