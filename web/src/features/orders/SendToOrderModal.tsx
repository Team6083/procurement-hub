import { Alert, Button, Dialog, NativeSelect, Stack, Text } from '@chakra-ui/react';
import { FormField } from '../../components/ui/field';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useAddItemsToOrder, useCreateOrder, useVendorOrderList } from '../../api/vendorOrders';
import { useVendors } from '../../api/vendors';
import type { QueueItem } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';

interface Props {
  items: QueueItem[];
  /** The vendor the picked items are grouped under (empty for the "other" group). */
  vendorId: string;
  /** Teams with items to buy at this vendor, for the merge hint. */
  otherTeamCount: number;
  onClose: () => void;
  onDone: (orderId: string) => void;
}

function Form({ items, vendorId: initialVendor, otherTeamCount, onDone }: Omit<Props, 'onClose'>) {
  const { t } = useTranslation('purchasing');
  const vendors = useVendors().data ?? [];
  const supported = useMeta().data?.supportedCurrencies ?? [];
  const [vendorId, setVendorId] = useState(initialVendor);
  const [currency, setCurrency] = useState('');
  const [target, setTarget] = useState('new');
  const drafts = useVendorOrderList({ status: 'draft', vendorId }, !!vendorId);
  const draftOrders = drafts.data?.pages.flatMap((p) => p.items) ?? [];
  const create = useCreateOrder();
  const addTo = useAddItemsToOrder();
  const vendor = vendors.find((v) => v.id === vendorId);
  const itemIds = items.map((i) => i.id);
  const busy = create.isPending || addTo.isPending;

  const submit = () => {
    if (target === 'new') {
      create.mutate({ vendorId, currency: currency || undefined, itemIds }, { onSuccess: (o) => onDone(o.id) });
      return;
    }
    const order = draftOrders.find((o) => o.id === target);
    if (order) addTo.mutate({ orderId: order.id, version: order.version, itemIds }, { onSuccess: (o) => onDone(o.id) });
  };

  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <Text>{t('send.items', { count: items.length })}</Text>
          {otherTeamCount > 1 && (
            <Alert.Root status="info">
              <Alert.Indicator />
              <Alert.Description>{t('send.mergeHint', { count: otherTeamCount })}</Alert.Description>
            </Alert.Root>
          )}
          <FormField label={t('list.vendor')}>
            <NativeSelect.Root size="md">
              <NativeSelect.Field
                value={vendorId ?? ''}
                onChange={(e) => { const v = e.currentTarget.value; setVendorId(v); setTarget('new'); }}
              >
                <option value="">{t('send.chooseVendor')}</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          <FormField label={t('send.target')} disabled={!vendorId}>
            <NativeSelect.Root size="md" disabled={!vendorId}>
              <NativeSelect.Field
                value={target ?? ''}
                onChange={(e) => setTarget(e.currentTarget.value)}
              >
                {!target && <option value="" />}
                <option value="new">{t('send.newOrder')}</option>
                {draftOrders.map((o) => (
                  <option key={o.id} value={o.id}>{t('send.addTo', { number: o.number, count: o.lineCount })}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          {target === 'new' && (
            <FormField label={t('details.currency')} disabled={!vendorId}>
              <NativeSelect.Root size="md" disabled={!vendorId}>
                <NativeSelect.Field
                  value={currency ?? ''}
                  onChange={(e) => setCurrency(e.currentTarget.value)}
                >
                  <option value="">{t('send.defaultCurrency', { currency: vendor?.defaultCurrency ?? '' })}</option>
                  {supported.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </FormField>
          )}
          <ErrorAlert error={create.error ?? addTo.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={busy} disabled={!vendorId} onClick={submit}>{target === 'new' ? t('send.create') : t('send.add')}</Button>
      </DialogFooter>
    </>
  );
}

/** Choose a vendor and a new or draft order for the picked items, then open that order. */
export function SendToOrderModal({ open, ...rest }: Props & { open: boolean }) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={open} onClose={rest.onClose} title={t('send.title')}>
      <Form {...rest} />
    </AppDialog>
  );
}
