import { Badge, Button, Card, Skeleton, Stack, Switch } from '@chakra-ui/react';
import { EmptyState, PageHeader, type DataColumn } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuStore } from 'react-icons/lu';
import { useMe } from '../api/me';
import { useVendors } from '../api/vendors';
import type { Vendor } from '../api/types';
import { DataTable } from '../components/DataTable';
import { ErrorAlert } from '../components/ErrorAlert';
import { VendorModal } from '../features/vendors/VendorModal';

/** The shared vendor list: everyone reads it, purchasers and system admins edit it. */
export function VendorsPage() {
  const { t } = useTranslation('admin');
  const { me, isSystemAdmin } = useMe();
  const canEdit = isSystemAdmin || !!me?.isPurchaser;
  const [inactive, setInactive] = useState(false);
  const vendors = useVendors(inactive);
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);

  const columns: DataColumn<Vendor>[] = [
    { key: 'name', header: t('vendors.name'), priority: 'primary', cell: (v) => v.name },
    { key: 'aliases', header: t('vendors.aliases'), priority: 'secondary', cell: (v) => v.aliases.join(', ') || '—' },
    { key: 'currency', header: t('vendors.currency'), cell: (v) => v.defaultCurrency },
    { key: 'status', header: t('vendors.status'), cell: (v) => (v.active ? <Badge colorPalette="green" variant="subtle">{t('vendors.active')}</Badge> : <Badge variant="outline">{t('vendors.inactive')}</Badge>) },
  ];

  return (
    <Stack gap="4">
      <PageHeader
        mb="0"
        title={t('vendors.title')}
        description={t('vendors.intro')}
        actions={canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <LuPlus />
            {t('vendors.create')}
          </Button>
        )}
      />
      <Switch.Root checked={inactive} onCheckedChange={(e) => setInactive(e.checked)}>
        <Switch.HiddenInput />
        <Switch.Control />
        <Switch.Label>{t('vendors.showInactive')}</Switch.Label>
      </Switch.Root>
      {vendors.isPending && <Skeleton h="24" rounded="l3" />}
      {vendors.error && <ErrorAlert error={vendors.error} />}
      {vendors.data && (
        <DataTable
          aria-label={t('vendors.title')}
          rows={vendors.data}
          columns={columns}
          getRowId={(v) => v.id}
          rowActions={canEdit ? (v) => [{ value: 'edit', label: t('common:actions.edit'), onSelect: () => setEditing(v) }] : undefined}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuStore />} title={t('vendors.empty')} /></Card.Body></Card.Root>}
        />
      )}
      <VendorModal open={editing !== null} vendor={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
    </Stack>
  );
}
