import { Button, Dialog, HStack, Input, Stack } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAddLine, usePutLine, type LineBody } from '../../api/vendorOrders';
import type { TeamSummary, VendorOrder, VendorOrderLine } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { currencyFractionDigits, validateAmount } from '../money';

interface Props {
  order: VendorOrder;
  teams: TeamSummary[];
  /** The line to edit, or null to add a standalone line. */
  line: VendorOrderLine | null;
  opened: boolean;
  onClose: () => void;
}

function Form({ order, teams, line, onClose }: Omit<Props, 'opened'>) {
  const { t } = useTranslation('purchasing');
  const add = useAddLine(order.id);
  const put = usePutLine(order.id);
  const [teamId, setTeamId] = useState(line?.teamId ?? '');
  const [name, setName] = useState(line?.name ?? '');
  const [sku, setSku] = useState(line?.sku ?? '');
  const [quantity, setQuantity] = useState(String(line?.quantity ?? 1));
  const [price, setPrice] = useState(line?.unitPrice ?? '');
  const placed = order.status === 'placed';
  const linked = !!line?.itemId;
  const mutation = line ? put : add;

  const priceError = price.trim() ? validateAmount(price, { digits: currencyFractionDigits(order.currency) }) : placed ? 'format' : null;
  const qtyOk = /^[1-9]\d*$/.test(quantity.trim());
  const valid = !!teamId && !!name.trim() && qtyOk && !priceError;

  const submit = () => {
    const body: LineBody = { teamId, name: name.trim(), sku: sku.trim(), quantity: Number(quantity), unitPrice: price.trim() || null };
    if (line) put.mutate({ line, body }, { onSuccess: onClose });
    else add.mutate(body, { onSuccess: onClose });
  };

  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <SelectField
            label={t('line.team')} value={teamId} onChange={setTeamId} placeholder={t('line.chooseTeam')} disabled={placed || linked}
            options={teams.map((x) => ({ value: x.id, label: x.name }))}
          />
          <FormField label={t('line.name')} required><Input value={name} onChange={(e) => setName(e.currentTarget.value)} /></FormField>
          <FormField label={t('line.sku')}><Input value={sku} onChange={(e) => setSku(e.currentTarget.value)} /></FormField>
          <HStack gap="3" align="flex-start">
            <FormField label={t('line.quantity')} errorText={qtyOk ? undefined : t('line.quantityInvalid')} disabled={placed}>
              <Input value={quantity} inputMode="numeric" onChange={(e) => setQuantity(e.currentTarget.value)} />
            </FormField>
            <FormField label={t('line.unitPrice', { currency: order.currency })} errorText={priceError ? t(`amount.${priceError}`) : undefined}>
              <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.currentTarget.value)} />
            </FormField>
          </HStack>
          <ErrorAlert error={mutation.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={mutation.isPending} disabled={!valid} onClick={submit}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Add a standalone line to a draft order, or edit a line (after placing: name, SKU and price only). */
export function LineFormModal({ opened, onClose, ...rest }: Props) {
  const { t } = useTranslation('purchasing');
  return (
    <AppDialog open={opened} onClose={onClose} title={rest.line ? t('line.edit') : t('line.add')}>
      <Form onClose={onClose} {...rest} />
    </AppDialog>
  );
}
