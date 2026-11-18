import { ClampedText } from '../../components/ClampedText';
import { currencyFractionDigits, formatMoney, validateAmount } from '../money';
import { Badge, Input, Link, Stack, Text } from '@chakra-ui/react';
import { type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPencil, LuTrash2, LuUndo2, LuX } from 'react-icons/lu';
import { usePutLine } from '../../api/vendorOrders';
import type { VendorOrder, VendorOrderLine } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { ErrorAlert } from '../../components/ErrorAlert';
import { safeHttpUrl } from '../batches/itemForm';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { LineStatusBadge } from './StatusBadges';

type PutLine = ReturnType<typeof usePutLine>;

/**
 * The unit price as an input that saves when it loses focus or Enter is pressed. A failed save keeps the typed value
 * and says so in a word; the error itself shows once, above the table.
 */
function PriceCell({ order, line, put }: { order: VendorOrder; line: VendorOrderLine; put: PutLine }) {
  const { t } = useTranslation('purchasing');
  const [value, setValue] = useState(line.unitPrice ?? '');
  const [shown, setShown] = useState(line.unitPrice ?? '');
  // Follow the server's price unless the user has typed something else.
  if ((line.unitPrice ?? '') !== shown) {
    setShown(line.unitPrice ?? '');
    if (value === shown) setValue(line.unitPrice ?? '');
  }
  const v = value.trim();
  const error = v ? validateAmount(v, { digits: currencyFractionDigits(order.currency) }) : order.status === 'placed' ? 'format' : null;
  const failed = !!put.error && put.variables?.line.id === line.id;
  const save = () => {
    if (v === (line.unitPrice ?? '') || error) return;
    put.mutate({ line, body: { teamId: line.teamId, name: line.name, sku: line.sku, quantity: line.quantity, unitPrice: v || null } });
  };
  const est = line.estimatedUnitPrice;
  const placeholder = est ? (est.currency === order.currency ? est.amount : `${est.amount} ${est.currency}`) : undefined;
  return (
    <Stack gap="1" align="flex-end">
      <Input
        size="xs" w="28" placeholder={placeholder} textAlign="end" value={value} inputMode="decimal" aria-label={t('line.priceOf', { n: line.lineNo })} aria-invalid={!!error || failed}
        onChange={(e) => setValue(e.currentTarget.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {error && v && <Text textStyle="xs" color="fg.error">{t(`amount.${error}`)}</Text>}
      {failed && !error && <Text textStyle="xs" color="fg.error">{t('line.notSaved')}</Text>}
    </Stack>
  );
}

interface Props {
  order: VendorOrder;
  baseCurrency: string;
  teamName: (id: string) => string;
  canWrite: boolean;
  onEdit: (l: VendorOrderLine) => void;
  onRemove: (l: VendorOrderLine) => void;
  onClose: (l: VendorOrderLine) => void;
  onReopen: (l: VendorOrderLine) => void;
}

export function LinesTable({ order, baseCurrency, teamName, canWrite, onEdit, onRemove, onClose, onReopen }: Props) {
  const { t, i18n } = useTranslation('purchasing');
  const put = usePutLine(order.id);
  const editable = canWrite && order.status !== 'cancelled';
  const placed = order.status === 'placed';
  const columns: DataColumn<VendorOrderLine>[] = [
    { key: 'no', header: '#', numeric: true, cell: (l) => l.lineNo },
    {
      key: 'name', header: t('line.name'), priority: 'primary',
      cell: (l) => (
        <Stack gap="0">
          {safeHttpUrl(l.productUrl)
            ? <Link href={safeHttpUrl(l.productUrl)} target="_blank" rel="noopener noreferrer" color="fg" textUnderlineOffset="3px"><ClampedText text={l.name} /></Link>
            : <ClampedText text={l.name} />}
          {l.sku && <Text textStyle="xs" color="fg.muted">{l.sku}</Text>}
          {l.batchId && <RouteAnchor to={paths.batch(l.batchId)} textStyle="xs" color="fg.muted">{t('line.fromBatch')}</RouteAnchor>}
        </Stack>
      ),
    },
    { key: 'team', header: t('line.team'), priority: 'secondary', cell: (l) => teamName(l.teamId) },
    { key: 'qty', header: t('line.quantity'), numeric: true, cell: (l) => l.quantity },
    {
      key: 'price', header: t('line.unitPriceShort'), numeric: true,
      cell: (l) => (editable ? <PriceCell order={order} line={l} put={put} /> : formatMoney(l.unitPrice, order.currency, i18n.language)),
    },
    ...(placed
      ? [{
          key: 'received', header: t('line.received'), numeric: true,
          cell: (l: VendorOrderLine) => (
            <Stack gap="1" align="flex-end">
              <span>{l.receivedQuantity} / {l.expectedQuantity}</span>
              {l.openProblemQuantity > 0 && <Badge colorPalette="red" variant="subtle">{t('line.problem', { count: l.openProblemQuantity })}</Badge>}
              {/* deliveryId is only filled for purchasers, receivers and system admins, who can open the delivery. */}
              {l.problems.filter((p) => p.deliveryId).map((p) => (
                <RouteAnchor key={p.id} to={paths.delivery(p.deliveryId!)} textStyle="xs" color="fg.muted">
                  {t('line.problemLink', { count: p.quantity, type: t(`receiving:problemType.${p.type}`), state: p.resolution ? t(`receiving:problem.actions.${p.resolution}`) : t('receiving:problem.open') })}
                </RouteAnchor>
              ))}
            </Stack>
          ),
        }]
      : []),
    { key: 'status', header: t('line.status'), cell: (l) => <LineStatusBadge status={l.status} /> },
    { key: 'total', header: t('line.total'), numeric: true, cell: (l) => formatMoney(l.totalBase, baseCurrency, i18n.language) },
  ];
  const rowActions = (l: VendorOrderLine): RowAction[] => {
    const out: RowAction[] = [];
    if (!editable) return out;
    if (order.status === 'draft' || placed) out.push({ value: 'edit', icon: <LuPencil />, label: t('line.edit'), onSelect: () => onEdit(l) });
    if (order.status === 'draft') out.push({ value: 'remove', icon: <LuTrash2 />, label: t('line.remove'), danger: true, onSelect: () => onRemove(l) });
    if (placed && l.closure) out.push({ value: 'reopen', icon: <LuUndo2 />, label: t('close.reopen'), onSelect: () => onReopen(l) });
    if (placed && !l.closure && l.receivedQuantity < l.expectedQuantity && l.openProblemQuantity === 0) {
      out.push({ value: 'close', icon: <LuX />, label: t('close.action'), danger: true, onSelect: () => onClose(l) });
    }
    return out;
  };
  return (
    <Stack gap="2">
      <ErrorAlert error={put.error} />
      <DataTable
        aria-label={t('line.title')} rows={order.lines} columns={columns} getRowId={(l) => l.id}
        rowActions={editable ? rowActions : undefined}
      />
    </Stack>
  );
}
