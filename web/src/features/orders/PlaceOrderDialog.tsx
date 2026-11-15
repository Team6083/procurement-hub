import { Button, HStack, Input, Stack } from '@chakra-ui/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMeta } from '../../api/meta';
import type { Item, Order } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { paths } from '../../paths';
import type { OrderPlan } from './placeOrders';
import { usePlaceExternalOrder } from './usePlaceExternalOrder';
import { MAX_VENDOR_LENGTH, commonVendor, defaultCurrency } from './rules';

/** What the user picked, frozen when the dialog opens (the lists behind it change as orders get created). */
export interface PlaceSnapshot {
  plans: OrderPlan[];
  drafts: Order[];
  items: Item[];
}

interface Props {
  snapshot: PlaceSnapshot | null;
  onClose: () => void;
  /** The external order exists; the picked rows are done. */
  onPlaced: () => void;
}

function Inner({ snapshot, onClose, onPlaced }: { snapshot: PlaceSnapshot; onClose: () => void; onPlaced: () => void }) {
  const { t } = useTranslation('orders');
  const meta = useMeta();
  const navigate = useNavigate();
  const place = usePlaceExternalOrder();
  // plan key -> created order id; kept across retries so nothing is created twice.
  const created = useRef(new Map<string, string>());
  const [createdCount, setCreatedCount] = useState(0);
  const currencies = meta.data?.supportedCurrencies ?? [];
  const [currency, setCurrency] = useState(() => defaultCurrency(snapshot.items, meta.data?.baseCurrency ?? ''));
  const named = [...snapshot.plans.map((p) => p.vendor), ...snapshot.drafts.map((o) => o.vendor)].filter((v) => v.trim() !== '');
  const common = commonVendor(named);
  const [vendor, setVendor] = useState(common);
  const valid = currency !== '' && vendor.trim() !== '' && vendor.length <= MAX_VENDOR_LENGTH;
  const submit = () =>
    place.mutate(
      { plans: snapshot.plans, draftOrderIds: snapshot.drafts.map((o) => o.id), currency, vendor: vendor.trim(), created: created.current },
      {
        onSuccess: (v) => { onPlaced(); onClose(); void navigate(paths.vendorTransaction(v.id)); },
        onSettled: () => setCreatedCount(created.current.size),
      },
    );
  return (
    <Stack gap="4">
      <SelectField size="md" label={t('external.currency')} helperText={t('external.currencyHelp')} value={currency} onChange={setCurrency} options={currencies} />
      <FormField label={t('create.vendor')} helperText={common ? undefined : t('external.vendorDiffers')}>
        <Input value={vendor} maxLength={MAX_VENDOR_LENGTH} onChange={(e) => setVendor(e.currentTarget.value)} />
      </FormField>
      {place.error && createdCount > 0 && <Notice>{t('place.partial', { count: createdCount })}</Notice>}
      <ErrorAlert error={place.error} />
      <HStack justify="flex-end">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={place.isPending} disabled={!valid} onClick={submit}>{place.error ? t('place.retry') : t('external.create')}</Button>
      </HStack>
    </Stack>
  );
}

/** Creates the missing team orders of the picked items, then one external order over them and any picked drafts. */
export function PlaceOrderDialog({ snapshot, onClose, onPlaced }: Props) {
  const { t } = useTranslation('orders');
  const count = snapshot ? snapshot.plans.length + snapshot.drafts.length : 0;
  return (
    <AppDialog open={!!snapshot} onClose={onClose} title={t('external.title', { count })}>
      {snapshot && <Inner snapshot={snapshot} onClose={onClose} onPlaced={onPlaced} />}
    </AppDialog>
  );
}
