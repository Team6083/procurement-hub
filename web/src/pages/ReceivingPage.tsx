import { Badge, Card, Skeleton, Stack, Tabs, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCircleCheck, LuInbox, LuUndo2, LuX } from 'react-icons/lu';
import { useLinesToClose, usePendingLines, useProblems, useUnresolveProblem } from '../api/deliveries';
import { useMeta } from '../api/meta';
import type { DeliveryLine, Problem, VendorOrderLine } from '../api/types';
import { useVendorOrder } from '../api/vendorOrders';
import { DataTable } from '../components/DataTable';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { UndoDialog } from '../components/UndoDialog';
import { shortDate, shortDay } from '../features/dates';
import { currencyFractionDigits } from '../features/money';
import { CloseLineModal } from '../features/orders/CloseLineModal';
import { useReceivingAccess } from '../features/receiving/access';
import { ResolveProblemModal } from '../features/receiving/ResolveProblemModal';
import { MatchStateBadge, ProblemBadge } from '../features/receiving/StatusBadges';
import { paths } from '../paths';

/** A compact empty state: these lists are usually empty, so they should not dominate the page. */
const emptyCard = (title: string) => <Card.Root size="sm"><Card.Body py="2"><EmptyState size="sm" py="2" icon={<LuInbox />} title={title} /></Card.Body></Card.Root>;
/** A section's count, left out when there is nothing to count. */
const countOf = (n: number | undefined) => (n ? n : undefined);

/** Delivery lines still waiting for a match; every receiver's worklist. */
function PendingLines() {
  const { t } = useTranslation('receiving');
  const q = usePendingLines();
  const columns: DataColumn<DeliveryLine>[] = [
    {
      key: 'line', header: t('pending.line'), priority: 'primary',
      cell: (l) => <Stack gap="0"><span>{l.name || l.sku}</span>{l.name && l.sku && <Text fontSize="xs" color="fg.muted">{l.sku}</Text>}</Stack>,
    },
    { key: 'delivery', header: t('pending.delivery'), cell: (l) => <RouteAnchor to={paths.delivery(l.deliveryId)}>{`DL-${l.deliveryNumber} #${l.lineNo}`}</RouteAnchor> },
    { key: 'qty', header: t('pending.quantity'), numeric: true, cell: (l) => l.goodQuantity + l.problemQuantity },
    { key: 'matched', header: t('pending.matched'), numeric: true, cell: (l) => l.matchedGoodQuantity + l.matchedProblemQuantity },
    { key: 'state', header: t('list.state'), cell: (l) => <MatchStateBadge state={l.matchState} /> },
    { key: 'received', header: t('box.receivedAt'), priority: 'secondary', cell: (l) => shortDay(l.receivedAt) },
  ];
  return (
    <Stack gap="2">
      <SectionHeader as="h2" mb="0" title={t('pending.title')} count={countOf(q.data?.length)} />
      {q.isPending && <Skeleton h="16" rounded="l3" />}
      <ErrorAlert error={q.error} />
      {q.data && <DataTable aria-label={t('pending.title')} rows={q.data} columns={columns} getRowId={(l) => l.id} empty={emptyCard(t('pending.empty'))} />}
    </Stack>
  );
}

function ProblemTable({ status, canPurchase, onResolve, onUnresolve }: { status: 'open' | 'resolved'; canPurchase: boolean; onResolve: (p: Problem) => void; onUnresolve: (p: Problem) => void }) {
  const { t } = useTranslation('receiving');
  const q = useProblems(status);
  const columns: DataColumn<Problem>[] = [
    {
      key: 'line', header: t('problem.line'), priority: 'primary',
      cell: (p) => <RouteAnchor to={paths.vendorOrder(p.vendorOrderId)}>{`VO-${p.vendorOrderNumber} #${p.lineNo} ${p.lineName}`}</RouteAnchor>,
    },
    { key: 'qty', header: t('pending.quantity'), numeric: true, cell: (p) => p.quantity },
    { key: 'type', header: t('problem.type'), cell: (p) => t(`problemType.${p.type}`) },
    { key: 'delivery', header: t('pending.delivery'), cell: (p) => (p.deliveryId ? <RouteAnchor to={paths.delivery(p.deliveryId)}>{`DL-${p.deliveryNumber ?? ''}`}</RouteAnchor> : '—') },
    { key: 'state', header: t('list.state'), cell: (p) => <ProblemBadge resolution={p.resolution?.action} /> },
    { key: 'note', header: t('problem.note'), priority: 'secondary', cell: (p) => p.resolution?.note || p.note || '—' },
    { key: 'created', header: t('list.created'), priority: 'secondary', cell: (p) => shortDate(p.createdAt) },
  ];
  const rowActions = (p: Problem): RowAction[] =>
    p.resolution
      ? [{ value: 'unresolve', icon: <LuUndo2 />, label: t('problem.unresolve'), onSelect: () => onUnresolve(p) }]
      : [{ value: 'resolve', icon: <LuCircleCheck />, label: t('problem.resolve'), onSelect: () => onResolve(p) }];
  if (q.isPending) return <Skeleton h="16" rounded="l3" />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <DataTable
      aria-label={`${t('problem.title')}: ${t(`problem.${status}Title`)}`} rows={q.data} columns={columns} getRowId={(p) => p.id}
      rowActions={canPurchase ? rowActions : undefined} empty={emptyCard(t(`problem.${status}Empty`))}
    />
  );
}

/** Open and recently resolved problems; purchasers settle them or undo a settlement. */
function Problems({ canPurchase, baseDigits }: { canPurchase: boolean; baseDigits: number }) {
  const { t } = useTranslation('receiving');
  const open = useProblems('open');
  const unresolve = useUnresolveProblem();
  const [resolving, setResolving] = useState<Problem | null>(null);
  const [undoing, setUndoing] = useState<Problem | null>(null);
  const handlers = { canPurchase, onResolve: setResolving, onUnresolve: (p: Problem) => { unresolve.reset(); setUndoing(p); } };
  return (
    <Stack gap="2">
      <SectionHeader as="h2" mb="0" title={t('problem.title')} count={countOf(open.data?.length)} />
      <Tabs.Root defaultValue="open" variant="subtle" size="sm" lazyMount>
        <Tabs.List>
          <Tabs.Trigger value="open">{t('problem.openTitle')}</Tabs.Trigger>
          <Tabs.Trigger value="resolved">{t('problem.resolvedTitle')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="open"><ProblemTable status="open" {...handlers} /></Tabs.Content>
        <Tabs.Content value="resolved"><ProblemTable status="resolved" {...handlers} /></Tabs.Content>
      </Tabs.Root>
      <ResolveProblemModal problem={resolving} baseDigits={baseDigits} onClose={() => setResolving(null)} />
      <UndoDialog
        opened={!!undoing} title={t('problem.unresolve')} body={t('problem.unresolveHelp')} confirmLabel={t('problem.unresolve')}
        loading={unresolve.isPending} error={unresolve.error} onClose={() => setUndoing(null)}
        onConfirm={(reason) => undoing && unresolve.mutate({ problem: undoing, reason }, { onSuccess: () => setUndoing(null) })}
      />
    </Stack>
  );
}

/** The close dialog needs the order in the cache (its version is the If-Match), so it waits for it. */
function CloseFromList({ line, baseDigits, onClose }: { line: VendorOrderLine | null; baseDigits: number; onClose: () => void }) {
  const order = useVendorOrder(line?.vendorOrderId);
  return <CloseLineModal orderId={line?.vendorOrderId ?? ''} line={order.data ? line : null} baseDigits={baseDigits} onClose={onClose} />;
}

/** Short lines without open problems: wait, or close the missing quantity. */
function LinesToClose({ canPurchase, baseDigits }: { canPurchase: boolean; baseDigits: number }) {
  const { t } = useTranslation('receiving');
  const q = useLinesToClose();
  const [closing, setClosing] = useState<VendorOrderLine | null>(null);
  const columns: DataColumn<VendorOrderLine>[] = [
    {
      key: 'line', header: t('problem.line'), priority: 'primary',
      cell: (l) => <RouteAnchor to={paths.vendorOrder(l.vendorOrderId)}>{`VO-${l.vendorOrderNumber} #${l.lineNo} ${l.name}`}</RouteAnchor>,
    },
    { key: 'received', header: t('toClose.received'), numeric: true, cell: (l) => `${l.receivedQuantity} / ${l.expectedQuantity}` },
    { key: 'missing', header: t('toClose.missing'), numeric: true, cell: (l) => <Badge variant="subtle" colorPalette="orange">{l.expectedQuantity - l.receivedQuantity}</Badge> },
  ];
  const rowActions = (l: VendorOrderLine): RowAction[] => [
    { value: 'close', icon: <LuX />, label: t('purchasing:close.action'), danger: true, onSelect: () => setClosing(l) },
  ];
  return (
    <Stack gap="2">
      <SectionHeader as="h2" mb="0" title={t('toClose.title')} count={countOf(q.data?.length)} />
      {q.isPending && <Skeleton h="16" rounded="l3" />}
      <ErrorAlert error={q.error} />
      {q.data && (
        <DataTable
          aria-label={t('toClose.title')} rows={q.data} columns={columns} getRowId={(l) => l.id}
          rowActions={canPurchase ? rowActions : undefined} empty={emptyCard(t('toClose.empty'))}
        />
      )}
      <CloseFromList line={closing} baseDigits={baseDigits} onClose={() => setClosing(null)} />
    </Stack>
  );
}

/** /receiving: the receiving workbench, the first tab of the Receiving page (ReceivingLayout). */
export function ReceivingPage() {
  const { canPurchase, isSystemAdmin } = useReceivingAccess();
  const baseDigits = currencyFractionDigits(useMeta().data?.baseCurrency ?? 'USD') ?? 2;
  // Receivers see only the matching worklist (spec 17.1); problems and closing are the purchasers' (admins read them).
  const purchasingView = canPurchase || isSystemAdmin;
  return (
    <Stack gap="6">
      <PendingLines />
      {purchasingView && <Problems canPurchase={canPurchase} baseDigits={baseDigits} />}
      {purchasingView && <LinesToClose canPurchase={canPurchase} baseDigits={baseDigits} />}
    </Stack>
  );
}
