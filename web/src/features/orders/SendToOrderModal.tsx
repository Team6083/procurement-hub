import { Button, Dialog, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useAddItemsToOrder, useCreateOrder, useVendorOrderList } from '../../api/vendorOrders';
import { useVendors } from '../../api/vendors';
import type { QueueItem } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { SelectField } from '../../components/ui/select';

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
    addTo.mutate({ orderId: target, version: draftOrders.find((o) => o.id === target)?.version ?? 0, itemIds }, { onSuccess: (o) => onDone(o.id) });
  };

  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <Text>{t('send.items', { count: items.length })}</Text>
          {otherTeamCount > 1 && <Notice status="info">{t('send.mergeHint', { count: otherTeamCount })}</Notice>}
          <SelectField
            label={t('list.vendor')} value={vendorId} onChange={(v) => { setVendorId(v); setTarget('new'); }} placeholder={t('send.chooseVendor')}
            options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          />
          <SelectField
            label={t('send.target')} value={target} onChange={setTarget} disabled={!vendorId}
            options={[{ value: 'new', label: t('send.newOrder') }, ...draftOrders.map((o) => ({ value: o.id, label: t('send.addTo', { number: o.number, count: o.lineCount }) }))]}
          />
          {target === 'new' && (
            <SelectField label={t('details.currency')} value={currency} onChange={setCurrency} placeholder={t('send.defaultCurrency', { currency: vendor?.defaultCurrency ?? '' })} options={supported} disabled={!vendorId} />
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
export function SendToOrderModal({ opened, ...rest }: Props & { opened: boolean }) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={opened} onClose={rest.onClose} title={t('send.title')}>
      <Form {...rest} />
    </AppDialog>
  );
}
