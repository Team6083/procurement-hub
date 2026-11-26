import { Button, Dialog, Input, Stack } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { DataTable, EmptyState, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LuCoins, LuPencil, LuTrash2 } from 'react-icons/lu';
import { z } from 'zod';
import { useMeta } from '../api/meta';
import { useDeleteRate, usePutRate, useReferenceRates } from '../api/vendors';
import type { ReferenceRate } from '../api/types';
import { useAccess } from '../auth/useAccess';
import { ErrorAlert } from '../components/ErrorAlert';
import { ListSkeleton } from '../components/PageStates';
import { ReasonModal } from '../components/ReasonModal';
import { AppDialog, DialogFooter } from '../components/ui/dialog';
import { FormField } from '../components/ui/field';
import { useFieldError } from '../components/ui/form';
import { shortDate } from '../features/dates';
import { MAX_RATE_DIGITS, validateAmount } from '../features/money';

interface Row {
  currency: string;
  rate: ReferenceRate | undefined;
}

const rateSchema = z.object({
  rate: z.string().trim().refine((v) => validateAmount(v, { digits: MAX_RATE_DIGITS, nonZero: true }) === null, 'admin:rates.invalid'),
});

function RateForm({ row, base, onClose }: { row: Row; base: string; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const put = usePutRate();
  const form = useForm({ resolver: zodResolver(rateSchema), defaultValues: { rate: row.rate?.rateToBase ?? '' } });
  const fieldError = useFieldError();
  const submit = form.handleSubmit((v) => put.mutate({ currency: row.currency, rateToBase: v.rate, existing: row.rate }, { onSuccess: onClose }));
  return (
    <>
      <Dialog.Body>
        <form id="rate-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('rates.rate', { currency: row.currency, base })} required errorText={fieldError(form.formState.errors.rate)}>
              <Input inputMode="decimal" {...form.register('rate')} />
            </FormField>
            <ErrorAlert error={put.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="rate-form" loading={put.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Global reference rates, one row per supported currency: system admins set and delete them, everyone else reads them. */
export function ReferenceRatesPage() {
  const { t } = useTranslation('admin');
  const { isSystemAdmin } = useAccess();
  const meta = useMeta();
  const rates = useReferenceRates();
  const del = useDeleteRate();
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<ReferenceRate | null>(null);
  const base = meta.data?.baseCurrency ?? '';
  const rows: Row[] = (meta.data?.supportedCurrencies ?? []).filter((c) => c !== base).map((currency) => ({ currency, rate: rates.data?.find((r) => r.currency === currency) }));

  const columns: DataColumn<Row>[] = [
    { key: 'currency', header: t('rates.currency'), priority: 'primary', cell: (r) => r.currency },
    { key: 'rate', header: t('rates.value'), numeric: true, cell: (r) => (r.rate ? `1 ${r.currency} = ${r.rate.rateToBase} ${base}` : t('rates.none')) },
    { key: 'updated', header: t('rates.updatedAt'), priority: 'secondary', cell: (r) => (r.rate ? shortDate(r.rate.updatedAt) : '—') },
  ];
  const rowActions = (r: Row): RowAction[] => [
    { value: 'edit', icon: <LuPencil />, label: r.rate ? t('rates.edit') : t('rates.set'), onSelect: () => setEditing(r) },
    ...(r.rate ? [{ value: 'delete', icon: <LuTrash2 />, label: t('rates.delete'), danger: true, onSelect: () => { del.reset(); setDeleting(r.rate!); } }] : []),
  ];

  return (
    <Stack gap="4">
      {rates.isPending && <ListSkeleton />}
      {rates.error && <ErrorAlert error={rates.error} />}
      {rates.data && (
        <DataTable
          aria-label={t('rates.title')} rows={rows} columns={columns} getRowId={(r) => r.currency}
          rowActions={isSystemAdmin ? rowActions : undefined}
          empty={<EmptyState icon={<LuCoins />} title={t('rates.noCurrencies')} />}
        />
      )}
      <AppDialog open={!!editing} onClose={() => setEditing(null)} title={editing?.rate ? t('rates.edit') : t('rates.set')} size="sm">
        {editing && <RateForm row={editing} base={base} onClose={() => setEditing(null)} />}
      </AppDialog>
      <ReasonModal
        open={!!deleting} danger title={t('rates.deleteTitle', { currency: deleting?.currency })} body={t('rates.deleteBody', { currency: deleting?.currency })}
        confirmLabel={t('common:actions.delete')} loading={del.isPending} error={del.error} onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </Stack>
  );
}
