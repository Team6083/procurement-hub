import { ClampedText } from '../../components/ClampedText';
import { currencyFractionDigits, formatMoney, validateAmount } from '../money';
import { Editable, HStack, IconButton, Link, Stack, Text } from '@chakra-ui/react';
import { DataTable, ToggleTip, type DataColumn, type RowAction } from '@team6083/ui';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LuInfo, LuPackage, LuPencil, LuTrash2, LuTriangleAlert, LuUndo2, LuX } from 'react-icons/lu';
import { usePutLine } from '../../api/vendorOrders';
import type { VendorOrder, VendorOrderLine } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { safeHttpUrl } from '../batches/itemForm';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { add, parseDecSafe, toFixed, ZERO } from '../batches/decimal';
import { LineStatusBadge, ProvisionalTip } from './StatusBadges';
import { StatusBadge } from '../../components/StatusBadge';

const TOTALS = Symbol('totals');
type Row = VendorOrderLine | typeof TOTALS;
type PutLine = ReturnType<typeof usePutLine>;

/**
 * The unit price as an editable text: click it to type, and it saves on Enter or when it loses focus (Escape cancels).
 * A failed save keeps the typed value and says so in a word; the error itself shows once, above the table.
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
  // A price is wrong when it is malformed; an empty price is only wrong on a placed order, which needs one on every line.
  const problem = (typed: string) => {
    const next = typed.trim();
    return next ? validateAmount(next, { digits: currencyFractionDigits(order.currency) }) : order.status === 'placed' ? 'format' : null;
  };
  const error = problem(value);
  const failed = !!put.error && put.variables?.line.id === line.id;
  const cancelled = useRef(false);
  // Enter and the blur that follows it both save: the second one must not send the same price again.
  const sent = useRef<string | null>(null);
  const save = (typed: string) => {
    const next = typed.trim();
    if (next === (line.unitPrice ?? '')) return;
    // A price that cannot be saved is not kept on screen: an empty one on a placed order goes back to the saved price.
    if (!next && problem(next)) { setValue(line.unitPrice ?? ''); return; }
    if (problem(next) || next === sent.current) return;
    sent.current = next;
    put.mutate({ line, body: { teamId: line.teamId, name: line.name, sku: line.sku, quantity: line.quantity, unitPrice: next || null } });
  };
  const est = line.estimatedUnitPrice;
  // An empty price reads "not set" (grey), so it is never mistaken for a price; the item's estimate is only the hint
  // while typing.
  const hint = est ? (est.currency === order.currency ? est.amount : `${est.amount} ${est.currency}`) : undefined;
  const placeholder = { preview: t('line.priceUnset'), edit: hint ?? '' };
  return (
    <Stack gap="1" align="flex-end">
      <Editable.Root
        size="sm" w="fit-content" submitMode="both" value={value} placeholder={placeholder} invalid={!!error || failed}
        onValueChange={(e) => setValue(e.value)} onValueCommit={(e) => save(e.value)}
        onValueRevert={() => setValue(line.unitPrice ?? '')}
      >
        <Editable.Preview />
        <Editable.Input
          onFocus={() => { cancelled.current = false; sent.current = null; }}
          onKeyDown={(e) => { if (e.key === 'Escape') cancelled.current = true; }}
          onBlur={(e) => { if (!cancelled.current) save(e.currentTarget.value); }}
          fieldSizing="content" minW="3ch" textAlign="end" inputMode="decimal" aria-label={t('line.priceOf', { n: line.lineNo })} />
      </Editable.Root>
      {error && value.trim() && <Text textStyle="xs" color="fg.error">{t(`amount.${error}`)}</Text>}
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
  const navigate = useNavigate();
  const put = usePutLine(order.id);
  const editable = canWrite && order.status !== 'cancelled';
  const placed = order.status === 'placed';
  // Base-currency amounts; provisional ones (computed from a reference rate) are marked.
  const money = (v: string | null, provisional = false) => (
    <span title={provisional && v ? t('provisional') : undefined}>
      {provisional && v ? '≈ ' : ''}{formatMoney(v, baseCurrency, i18n.language)}
    </span>
  );
  // The goods amount is the vendor's invoice line, in the order currency.
  const orderMoney = (v: string | null) => formatMoney(v, order.currency, i18n.language);
  const columns: DataColumn<VendorOrderLine>[] = [
    { key: 'no', header: '#', numeric: true, cell: (l) => l.lineNo },
    {
      key: 'name', header: t('line.name'), priority: 'primary',
      cell: (l) => (
        <Stack gap="0" minW="48">
          {safeHttpUrl(l.productUrl)
            ? <Link href={safeHttpUrl(l.productUrl)} target="_blank" rel="noopener noreferrer" color="fg" textUnderlineOffset="3px"><ClampedText text={l.name} /></Link>
            : <ClampedText text={l.name} />}
          {l.sku && <Text textStyle="xs" color="fg.muted">{l.sku}</Text>}
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
          <HStack gap="1" justify="flex-end">
            {/* The problems are behind an icon: the cell stays one line, and the details open on click. */}
            {(l.openProblemQuantity > 0 || l.problems.some((p) => p.deliveryId)) && (
              <ToggleTip
                content={(
                  <Stack gap="1" align="flex-start">
                    {l.openProblemQuantity > 0 && <StatusBadge tone="attention">{t('line.problem', { count: l.openProblemQuantity })}</StatusBadge>}
                    {/* deliveryId is only filled for purchasers, receivers and system admins, who can open the delivery. */}
                    {l.problems.filter((p) => p.deliveryId).map((p) => (
                      <RouteAnchor key={p.id} to={paths.delivery(p.deliveryId!)} textStyle="xs">
                        {t('line.problemLink', { count: p.quantity, type: t(`receiving:problemType.${p.type}`), state: p.resolution ? t(`receiving:problem.actions.${p.resolution}`) : t('receiving:problem.open') })}
                      </RouteAnchor>
                    ))}
                  </Stack>
                )}
              >
                <IconButton variant="ghost" size="2xs" colorPalette={l.openProblemQuantity > 0 ? 'orange' : 'gray'} aria-label={t('line.problem', { count: l.openProblemQuantity })}>
                  {l.openProblemQuantity > 0 ? <LuTriangleAlert /> : <LuInfo />}
                </IconButton>
              </ToggleTip>
            )}
            <span>{l.receivedQuantity} / {l.expectedQuantity}</span>
          </HStack>
        ),
      }]
      : []),
    { key: 'status', header: t('line.status'), cell: (l) => <LineStatusBadge status={l.status} /> },
    { key: 'goods', header: t('line.goods'), numeric: true, cell: (l) => orderMoney(l.lineC) },
    { key: 'checkout', header: t('line.checkout'), numeric: true, cell: (l) => money(l.sharedBase, l.costProvisional) },
    { key: 'separate', header: t('line.separate'), numeric: true, cell: (l) => money(l.separateBase, l.separateProvisional) },
    { key: 'total', header: t('line.total'), numeric: true, cell: (l) => money(l.totalBase, l.costProvisional || l.separateProvisional) },
  ];
  const rowActions = (l: VendorOrderLine): RowAction[] => {
    const out: RowAction[] = [];
    if (l.batchId) out.push({ value: 'batch', icon: <LuPackage />, label: t('line.openBatch'), onSelect: () => void navigate(paths.batch(l.batchId!)) });
    if (!editable) return out;
    if (order.status === 'draft' || placed) out.push({ value: 'edit', icon: <LuPencil />, label: t('line.edit'), onSelect: () => onEdit(l) });
    if (order.status === 'draft') out.push({ value: 'remove', icon: <LuTrash2 />, label: t('line.remove'), danger: true, onSelect: () => onRemove(l) });
    if (placed && l.closure) out.push({ value: 'reopen', icon: <LuUndo2 />, label: t('close.reopen'), onSelect: () => onReopen(l) });
    if (placed && !l.closure && l.receivedQuantity < l.expectedQuantity && l.openProblemQuantity === 0) {
      out.push({ value: 'close', icon: <LuX />, label: t('close.action'), danger: true, onSelect: () => onClose(l) });
    }
    return out;
  };
  // The totals row: the goods total in the order currency, the with-checkout sum of the lines shown, separate payments and the net total from the order's totals.
  const showTotals = !order.restricted && order.lines.length > 0;
  const sum = (pick: (l: VendorOrderLine) => string | null) => {
    let acc = ZERO;
    for (const l of order.lines) {
      const v = pick(l);
      if (v === null) return null;
      acc = add(acc, parseDecSafe(v));
    }
    return toFixed(acc, acc.s);
  };
  const totalsCell: Record<string, ReactNode> = {
    name: <b>{t('line.totals')}</b>,
    goods: orderMoney(order.totals.linesC),
    checkout: money(sum((l) => l.sharedBase), order.totals.factorProvisional),
    separate: money(order.totals.separateBase, order.lines.some((l) => l.separateProvisional)),
    total: <HStack gap="2" justify="flex-end">{order.totals.provisional && <ProvisionalTip />}<b>{money(order.totals.netBase, order.totals.provisional)}</b></HStack>,
  };
  const rows: Row[] = showTotals ? [...order.lines, TOTALS] : order.lines;
  const cols: DataColumn<Row>[] = columns.map((c) => ({ ...c, sortValue: c.sortValue && ((r: Row) => (r === TOTALS ? null : c.sortValue!(r))), cell: (r: Row) => (r === TOTALS ? (totalsCell[c.key] ?? null) : c.cell(r)) }));
  return (
    <Stack gap="2">
      <ErrorAlert error={put.error} />
      <DataTable
        aria-label={t('line.title')} rows={rows} columns={cols} getRowId={(l) => (l === TOTALS ? 'totals' : l.id)}
        rowActions={(r) => (r === TOTALS ? [] : rowActions(r))}
      />
    </Stack>
  );
}
