import { Button, HStack, Spinner, Stack, Text, Timeline } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useBatchAudit } from '../../api/batches';
import type { AuditEvent } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { auditActionKey, isSystemActor } from './audit';

function statusChange(ev: AuditEvent, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const c = ev.changes?.find((x) => x.field === 'status');
  if (!c || typeof c.to !== 'string' || !c.to) return null;
  const label = (s: unknown) => (typeof s === 'string' && s ? t(`${ev.objectType === 'item' ? 'itemStatus' : 'status'}.${s}`, { defaultValue: s }) : '');
  return c.from ? `${label(c.from)} → ${label(c.to)}` : label(c.to);
}

export function TimelineTab({ batchId, nameOf }: { batchId: string; nameOf: (id: string) => string }) {
  const { t } = useTranslation('batches');
  const audit = useBatchAudit(batchId);
  if (audit.isPending) return <Spinner />;
  if (audit.error) return <ErrorAlert error={audit.error} />;
  // The server returns the batch timeline oldest-first; keep its order across pages.
  const events = audit.data.pages.flatMap((p) => p.items);
  if (events.length === 0) return <Text color="fg.muted">{t('timeline.empty')}</Text>;
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
                <Timeline.Description>{actor} · {new Date(ev.at).toLocaleString()}</Timeline.Description>
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
      {audit.hasNextPage && (
        <HStack>
          <Button variant="outline" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
    </Stack>
  );
}
