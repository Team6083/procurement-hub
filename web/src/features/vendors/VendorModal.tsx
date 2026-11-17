import { Button, Dialog, Input, Stack, Switch, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useCreateVendor, usePutVendor, type VendorBody } from '../../api/vendors';
import type { Vendor } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { safeHttpUrl } from '../batches/itemForm';

function Inner({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const meta = useMeta();
  const create = useCreateVendor();
  const put = usePutVendor();
  const base = meta.data?.baseCurrency ?? '';
  const currencies = meta.data?.supportedCurrencies ?? [];
  const [name, setName] = useState(vendor?.name ?? '');
  const [aliases, setAliases] = useState((vendor?.aliases ?? []).join('\n'));
  const [currency, setCurrency] = useState(vendor?.defaultCurrency ?? base);
  const [website, setWebsite] = useState(vendor?.website ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [active, setActive] = useState(vendor?.active ?? true);
  const [tried, setTried] = useState(false);
  const badUrl = website.trim() !== '' && safeHttpUrl(website.trim()) === undefined;
  const mutation = vendor ? put : create;
  const save = () => {
    setTried(true);
    if (!name.trim() || badUrl) return;
    const body: VendorBody = {
      name: name.trim(), aliases: aliases.split('\n').map((a) => a.trim()).filter(Boolean), defaultCurrency: currency,
      website: website.trim(), notes, active,
    };
    if (vendor) put.mutate({ vendor, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <FormField label={t('vendors.name')} required errorText={tried && !name.trim() ? t('common:validation.required') : undefined}><Input value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={200} /></FormField>
          <FormField label={t('vendors.aliases')} helperText={t('vendors.aliasesHelp')}>
            <Textarea value={aliases} onChange={(e) => setAliases(e.currentTarget.value)} autoresize rows={2} />
          </FormField>
          <SelectField label={t('vendors.currency')} value={currency} onChange={setCurrency} options={currencies.length ? currencies : [base]} />
          <FormField label={t('vendors.website')} errorText={badUrl ? t('vendors.badUrl') : undefined}>
            <Input value={website} onChange={(e) => setWebsite(e.currentTarget.value)} inputMode="url" />
          </FormField>
          <FormField label={t('vendors.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autoresize rows={2} /></FormField>
          {vendor && (
            <Switch.Root checked={active} onCheckedChange={(e) => setActive(e.checked)}>
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>{t('vendors.active')}</Switch.Label>
            </Switch.Root>
          )}
          <ErrorAlert error={mutation.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={mutation.isPending} onClick={save}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Create or edit a vendor; deactivate instead of deleting. */
export function VendorModal({ opened, vendor, onClose }: { opened: boolean; vendor: Vendor | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <AppDialog open={opened} onClose={onClose} title={vendor ? t('vendors.edit') : t('vendors.create')}>
      <Inner vendor={vendor} onClose={onClose} />
    </AppDialog>
  );
}
