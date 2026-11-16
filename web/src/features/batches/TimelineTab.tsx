import { Button, HStack, Skeleton, Stack, Text, Timeline } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useBatchAudit } from '../../api/batches';
import type { AuditEvent } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { auditActionKey, isSystemActor } from './audit';
import { EmptyState } from '@team6083/ui';
import { LuHistory } from 'react-icons/lu';
import { shortDate } from '../dates';

function statusChange(ev: AuditEvent, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const c = ev.changes?.find((x) => x.field === 'status');
  if (!c || typeof c.to !== 'string' || !c.to) return null;
  const label = (s: unknown) => (typeof s === 'string' && s ? t(`${ev.objectType === 'item' ? 'itemStatus' : 'status'}.${s}`, { defaultValue: s }) : '');
  return c.from ? `${label(c.from)} → ${label(c.to)}` : label(c.to);
}

export function TimelineTab({ batchId, nameOf }: { batchId: string; nameOf: (id: string) => string }) {
  const { t } = useTranslation('batches');
  const audit = useBatchAudit(batchId);
  if (audit.isPending) return <Skeleton h="24" rounded="l3" />;
  if (audit.error) return <ErrorAlert error={audit.error} />;
  // The server returns the batch timeline oldest-first; keep its order across pages.
  const events = audit.data.pages.flatMap((p) => p.items);
  if (events.length === 0) return <EmptyState icon={<LuHistory />} title={t('timeline.empty')} />;
  return (
    <Stack gap="4">
      <Timeline.Root size="sm">
        {events.map((ev) => {
          const sc = statusChange(ev, t);
          const actor = isSystemActor(ev.actor) ? t('timeline.system') : nameOf(ev.actor);
          return (
            <Timeline.Item key={ev.id}>
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator />
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title>{t(auditActionKey(ev.action), { defaultValue: t('timeline.generic', { action: ev.action }) })}</Timeline.Title>
                {sc && <Text fontSize="sm">{sc}</Text>}
                {ev.comment && <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">“{ev.comment}”</Text>}
                <Timeline.Description>{actor} · {shortDate(ev.at)}</Timeline.Description>
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
      {audit.hasNextPage && (
        <HStack>
          <Button size="sm" variant="outline" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
    </Stack>
  );
}
