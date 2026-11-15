import { Button, HStack, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useResolveException } from '../../api/receiving';
import type { ExceptionAction, Item, ItemException } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { currencyFractionDigits } from '../money';
import { useAmountError } from '../orders/OrderBadges';
import { EXCEPTION_ACTIONS, MAX_RESOLVE_NOTE, checkResolve } from './rules';

export interface Resolving {
  item: Item;
  exception: ItemException;
}

interface Props {
  target: Resolving | null;
  batchId: string;
  onClose: () => void;
}

function Inner({ target, batchId, onClose }: Props & { target: Resolving }) {
  const { t } = useTranslation('receiving');
  const meta = useMeta();
  const base = meta.data?.baseCurrency ?? '';
  const resolve = useResolveException(batchId, target.item.id);
  const amountText = useAmountError();
  const [form, setForm] = useState<{ action: ExceptionAction; note: string; refund: string }>({ action: 'exchange', note: '', refund: '' });
  const [touched, setTouched] = useState(false);
  const check = checkResolve(form, target.item.receivedQuantity, base ? currencyFractionDigits(base) : undefined);
  const closes = form.action !== 'exchange';
  return (
    <Stack gap="4">
      <Text color="fg.muted">{t(`exceptionType.${target.exception.type}`)}: {target.exception.description}</Text>
      <SelectField size="md" label={t('resolve.action')} value={form.action} onChange={(v) => setForm((f) => ({ ...f, action: v as ExceptionAction }))}
        helperText={t(`resolve.help.${form.action}`)}
        options={EXCEPTION_ACTIONS.map((x) => ({ value: x, label: t(`resolve.actions.${x}`) }))} />
      {check.nothingReceived && <Text color="fg.error" role="alert">{t('resolve.nothingReceived')}</Text>}
      {closes && (
        <>
          <FormField label={t('resolve.note')} errorText={touched && check.noteError ? t(`validation.note.${check.noteError}`) : undefined}>
            <Textarea autoresize rows={2} maxLength={MAX_RESOLVE_NOTE} value={form.note} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, note: v })); }} onBlur={() => setTouched(true)} />
          </FormField>
          <FormField label={t('resolve.refund', { currency: base })} helperText={t('resolve.refundHelp')} errorText={amountText(check.refundError)}>
            <Input size="lg" inputMode="decimal" value={form.refund} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, refund: v })); }} />
          </FormField>
        </>
      )}
      <ErrorAlert error={resolve.error} />
      <HStack justify="flex-end">
        <Button size="lg" variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button size="lg" loading={resolve.isPending} disabled={!check.valid} onClick={() => resolve.mutate({ exception: target.exception, body: check.body }, { onSuccess: onClose })}>
          {t('resolve.submit')}
        </Button>
      </HStack>
    </Stack>
  );
}

export function ResolveModal(props: Props) {
  const { t } = useTranslation('receiving');
  return (
    <AppDialog open={!!props.target} onClose={props.onClose} title={t('resolve.title', { name: props.target?.item.name })}>
      {props.target && <Inner {...props} target={props.target} />}
    </AppDialog>
  );
}
