import { deliveryLabel } from '../labels';
import { Alert, Badge, Button, Card, Stack } from '@chakra-ui/react';
import { FactList, TitleBar } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan } from 'react-icons/lu';
import { useDelivery, useNoMatch, useVoidDelivery } from '../../api/deliveries';
import type { DeliveryLine } from '../../api/types';
import { ReasonModal } from '../../components/ReasonModal';
import { shortDate, shortDay } from '../dates';
import { useAccess } from '../../auth/useAccess';
import { DeliveryLineCard } from './DeliveryLineCard';
import { LoadError, PageSkeleton } from '../../components/PageStates';
import { MatchEditor } from './MatchEditor';
import { VoidedBadge } from './StatusBadges';

/** One delivery (box): its lines, their matches, the no-match marks and voiding (spec 17.1 /deliveries/:id). */
export function DeliveryView({ id }: { id: string }) {
  const { t } = useTranslation('receiving');
  const { canReceive: mayWrite } = useAccess();
  const q = useDelivery(id);
  const voidIt = useVoidDelivery(id);
  const noMatch = useNoMatch(id);
  const [matching, setMatching] = useState<DeliveryLine | null>(null);
  const [marking, setMarking] = useState<{ line: DeliveryLine; undo: boolean } | null>(null);
  const [voiding, setVoiding] = useState(false);

  if (q.isPending) return <PageSkeleton />;
  if (q.error || !q.data) return <LoadError error={q.error} />;
  const d = q.data;
  const canWrite = mayWrite && !d.voided;
  // Always the fresh copy of the line, so a dialog never edits a stale one after a refetch.
  const current = (l: DeliveryLine | null) => (l ? d.lines.find((x) => x.id === l.id) ?? null : null);
  const closeMark = () => { setMarking(null); noMatch.reset(); };

  return (
    <Stack gap="6">
      <Stack gap="4">
        <TitleBar level={1} title={deliveryLabel(d.number)} after={d.voided ? <VoidedBadge /> : undefined} end={canWrite && <Button size="sm" variant="outline" colorPalette="red" onClick={() => { voidIt.reset(); setVoiding(true); }}><LuBan />{t('void.action')}</Button>} />
        {d.voided && (
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Description>{t('void.done', { reason: d.voided.reason })}</Alert.Description>
          </Alert.Root>
        )}
        <Card.Root size="sm">
          <Card.Body>
            <FactList
              items={[
                { label: t('box.receivedAt'), value: shortDay(d.receivedAt) },
                { label: t('box.source'), value: d.source || '—' },
                { label: t('box.note'), value: d.note || '—' },
                { label: t('list.created'), value: shortDate(d.createdAt) },
              ]}
            />
          </Card.Body>
        </Card.Root>
      </Stack>

      <Stack gap="2">
        <TitleBar level={2} title={t('line.title')} after={<Badge>{d.lines.length}</Badge>} />
        {d.lines.map((l) => (
          <DeliveryLineCard
            key={l.id} line={l} canWrite={canWrite}
            onMatch={() => setMatching(l)} onNoMatch={() => { noMatch.reset(); setMarking({ line: l, undo: false }); }}
            onUndoNoMatch={() => { noMatch.reset(); setMarking({ line: l, undo: true }); }}
          />
        ))}
      </Stack>

      <MatchEditor deliveryId={d.id} line={current(matching)} onClose={() => setMatching(null)} />
      <ReasonModal
        open={!!marking && !marking.undo} title={t('noMatch.action')} body={t('noMatch.help')} reasonLabel={t('noMatch.reason')} confirmLabel={t('noMatch.action')}
        loading={noMatch.isPending} error={noMatch.error} onClose={closeMark}
        onConfirm={(reason) => marking && noMatch.mutate({ lineId: marking.line.id, undo: false, reason }, { onSuccess: closeMark })}
      />
      <ReasonModal reasonLabel={t('common:undo.reason')}
        open={!!marking?.undo} title={t('noMatch.undo')} body={t('noMatch.undoHelp')} confirmLabel={t('noMatch.undo')}
        loading={noMatch.isPending} error={noMatch.error} onClose={closeMark}
        onConfirm={(reason) => marking && noMatch.mutate({ lineId: marking.line.id, undo: true, reason }, { onSuccess: closeMark })}
      />
      <ReasonModal reasonLabel={t('common:undo.reason')}
        open={voiding} title={t('void.action')} body={t('void.help')} confirmLabel={t('void.action')}
        loading={voidIt.isPending} error={voidIt.error} onClose={() => setVoiding(false)}
        onConfirm={(reason) => voidIt.mutate({ reason }, { onSuccess: () => setVoiding(false) })}
      />
    </Stack>
  );
}
