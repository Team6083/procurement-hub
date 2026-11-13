import { Button, Group, Loader, Stack, Text, Timeline } from '@mantine/core';
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
  if (audit.isPending) return <Loader />;
  if (audit.error) return <ErrorAlert error={audit.error} />;
  // The server returns the batch timeline oldest-first; keep its order across pages.
  const events = audit.data.pages.flatMap((p) => p.items);
  if (events.length === 0) return <Text c="dimmed">{t('timeline.empty')}</Text>;
  return (
    <Stack>
    <Timeline bulletSize={14} lineWidth={2}>
      {events.map((ev) => {
        const sc = statusChange(ev, t);
        const actor = isSystemActor(ev.actor) ? t('timeline.system') : nameOf(ev.actor);
        return (
          <Timeline.Item key={ev.id} title={t(auditActionKey(ev.action), { defaultValue: t('timeline.generic', { action: ev.action }) })}>
            <Stack gap={0}>
              {sc && <Text size="sm">{sc}</Text>}
              {ev.comment && <Text size="sm" c="dimmed">“{ev.comment}”</Text>}
              <Text size="xs" c="dimmed">{actor} · {new Date(ev.at).toLocaleString()}</Text>
            </Stack>
          </Timeline.Item>
        );
      })}
    </Timeline>
    {audit.hasNextPage && (
      <Group>
        <Button variant="default" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t('list.loadMore')}</Button>
      </Group>
    )}
    </Stack>
  );
}
