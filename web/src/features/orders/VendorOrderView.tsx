import { Button, Card, HStack, Skeleton, Stack, Text } from '@chakra-ui/react';
import { FactList, PageHeader, SectionHeader } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCircleCheck, LuPlus, LuUndo2 } from 'react-icons/lu';
import { useMe } from '../../api/me';
import { useMeta } from '../../api/meta';
import { useTeams } from '../../api/teams';
import type { VendorOrderLine } from '../../api/types';
import { useDeleteLine, useOrderAction, useReopenLine, useVendorOrder, type OrderAction } from '../../api/vendorOrders';
import { useVendors } from '../../api/vendors';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { UndoDialog } from '../../components/UndoDialog';
import { currencyFractionDigits } from '../money';
import { shortDate } from '../dates';
import { Breakdown } from './Breakdown';
import { CloseLineModal } from './CloseLineModal';
import { DetailsForm } from './DetailsForm';
import { LedgerSection } from './LedgerSection';
import { LineFormModal } from './LineFormModal';
import { LinesTable } from './LinesTable';
import { formatMoney } from './money';
import { OrderStatusBadge, ProvisionalBadge } from './StatusBadges';
import { OrderTimeline } from './OrderTimeline';

/**
 * One vendor order: lines and unit prices, shared costs, ledger, the calculation with its invariant check and the
 * timeline. Used as a page and inside the purchasing page's dialog (the single-team flow stays on one screen).
 */
export function VendorOrderView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { t, i18n } = useTranslation('purchasing');
  const { me } = useMe();
  const meta = useMeta().data;
  const teams = useTeams().data ?? [];
  const vendors = useVendors(true).data ?? [];
  const q = useVendorOrder(id);
  const action = useOrderAction(id);
  const del = useDeleteLine(id);
  const reopen = useReopenLine(id);
  const [lineForm, setLineForm] = useState<VendorOrderLine | 'new' | null>(null);
  const [closing, setClosing] = useState<VendorOrderLine | null>(null);
  const [reopening, setReopening] = useState<VendorOrderLine | null>(null);
  const [removing, setRemoving] = useState<VendorOrderLine | null>(null);
  const [undo, setUndo] = useState<Exclude<OrderAction, 'place'> | null>(null);

  if (q.isPending) return <Skeleton h="32" rounded="l3" />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  const order = q.data;
  const baseCurrency = meta?.baseCurrency ?? 'USD';
  const baseDigits = currencyFractionDigits(baseCurrency) ?? 2;
  const canWrite = !!me?.isPurchaser && !order.restricted;
  const teamName = (tid: string) => teams.find((x) => x.id === tid)?.name ?? t('line.unknownTeam');
  const draft = order.status === 'draft';
  const vendor = order.vendorName;
  const close = () => { setUndo(null); action.reset(); };

  const header = (
    <>
      <OrderStatusBadge status={order.status} />
      {order.totals.provisional && <ProvisionalBadge />}
    </>
  );
  const actions = canWrite && (
    <HStack wrap="wrap" gap="2">
      {draft && (
        <Button size="sm" loading={action.isPending && action.variables?.action === 'place'} onClick={() => { action.reset(); action.mutate({ action: 'place' }); }}>
          <LuCircleCheck />{t('actions.place')}
        </Button>
      )}
      {draft && <Button size="sm" variant="outline" colorPalette="red" onClick={() => { action.reset(); setUndo('cancel'); }}><LuBan />{t('actions.cancel')}</Button>}
      {order.status === 'placed' && <Button size="sm" variant="outline" onClick={() => { action.reset(); setUndo('unplace'); }}><LuUndo2 />{t('actions.unplace')}</Button>}
      {order.status === 'cancelled' && <Button size="sm" variant="outline" onClick={() => { action.reset(); setUndo('uncancel'); }}><LuUndo2 />{t('actions.uncancel')}</Button>}
    </HStack>
  );

  return (
    <Stack gap="4">
      {embedded ? (
        <HStack justify="space-between" wrap="wrap">
          <HStack gap="2"><Text fontWeight="semibold">{`VO-${order.number}`}</Text><Text color="fg.muted">{vendor}</Text>{header}</HStack>
          {actions}
        </HStack>
      ) : (
        <PageHeader mb="0" title={`VO-${order.number} · ${vendor}`} badge={<HStack gap="2">{header}</HStack>} actions={actions} />
      )}
      {order.restricted && <Notice status="info">{t('restricted')}</Notice>}
      {order.overridesCleared && <Notice status="warning">{t('details.overridesCleared')}</Notice>}
      {order.status === 'cancelled' && order.cancellation && <Notice>{t('cancelledReason', { reason: order.cancellation.reason })}</Notice>}
      {!undo && <ErrorAlert error={action.error} />}
      <Card.Root size="sm">
        <Card.Body>
          <FactList
            minChildWidth={{ base: '9rem', md: '12rem' }}
            items={[
              { label: t('details.currency'), value: order.currency },
              { label: t('details.externalNo'), value: order.externalOrderNo || '—' },
              { label: t('details.placedAt'), value: shortDate(order.placedAt) },
              { label: t('details.delivery'), value: order.expectedDeliveryDate || '—' },
              ...(order.restricted ? [] : [{ label: t('details.charged'), value: formatMoney(order.chargedAmountBase, baseCurrency, i18n.language) }]),
            ]}
          />
        </Card.Body>
      </Card.Root>

      <Stack gap="2">
        <SectionHeader
          as="h3" title={t('line.title')} count={order.lines.length}
          actions={canWrite && draft && <Button size="xs" variant="outline" onClick={() => setLineForm('new')}><LuPlus />{t('line.add')}</Button>}
        />
        <LinesTable
          order={order} baseCurrency={baseCurrency} teamName={teamName} canWrite={canWrite}
          onEdit={setLineForm} onRemove={(l) => { del.reset(); setRemoving(l); }} onClose={setClosing} onReopen={(l) => { reopen.reset(); setReopening(l); }}
        />
      </Stack>

      <Breakdown order={order} baseCurrency={baseCurrency} />

      {canWrite && order.status !== 'cancelled' && (
        <DetailsForm
          key={JSON.stringify([order.vendorId, order.currency, order.externalOrderNo, order.expectedDeliveryDate, order.paymentNote, order.chargedAmountBase, order.sharedCosts, order.teamCostOverrides, order.overrideReason, order.teamIds])}
          order={order} vendors={vendors} supported={meta?.supportedCurrencies ?? [order.currency]} teamName={teamName} baseDigits={baseDigits}
        />
      )}
      <LedgerSection order={order} baseCurrency={baseCurrency} baseDigits={baseDigits} canWrite={canWrite} />

      <Stack gap="2">
        <SectionHeader as="h3" title={t('timeline.title')} />
        <OrderTimeline orderId={order.id} />
      </Stack>

      <LineFormModal order={order} teams={teams} line={lineForm && lineForm !== 'new' ? lineForm : null} opened={lineForm !== null} onClose={() => setLineForm(null)} />
      <CloseLineModal orderId={order.id} line={closing} baseDigits={baseDigits} onClose={() => setClosing(null)} />
      <UndoDialog
        opened={!!reopening} title={t('close.reopen')} body={t('close.reopenHelp')} confirmLabel={t('close.reopen')}
        loading={reopen.isPending} error={reopen.error} onClose={() => setReopening(null)}
        onConfirm={(reason) => reopening && reopen.mutate({ line: reopening, reason }, { onSuccess: () => setReopening(null) })}
      />
      <ReasonModal
        opened={!!removing} danger title={t('line.remove')} body={removing && t('line.removeHelp', { name: removing.name })} confirmLabel={t('line.remove')}
        loading={del.isPending} error={del.error} onClose={() => setRemoving(null)}
        onConfirm={() => removing && del.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
      <UndoDialog
        opened={!!undo} title={t(`actions.${undo ?? 'unplace'}`)} body={t(`actions.${undo ?? 'unplace'}Help`)} confirmLabel={t(`actions.${undo ?? 'unplace'}`)}
        loading={action.isPending} error={action.error} onClose={close}
        onConfirm={(reason) => undo && action.mutate({ action: undo, reason }, { onSuccess: close })}
      />
    </Stack>
  );
}
