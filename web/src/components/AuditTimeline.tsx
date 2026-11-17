import { Button, Card, HStack, Stack, Text, Timeline } from '@chakra-ui/react';
import { EmptyState } from '@team6083/ui';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuHistory } from 'react-icons/lu';
import type { AuditEvent, Page } from '../api/types';
import { shortDate } from '../features/dates';
import { ErrorAlert } from './ErrorAlert';
import { ListSkeleton } from './PageStates';

/** How one object's events read: the action's title, what changed, and who did it. */
export interface AuditFormat {
  title: (ev: AuditEvent) => string;
  detail?: (ev: AuditEvent) => ReactNode;
  actor: (actor: string) => string;
}

export const isSystemActor = (actor: string) => actor.startsWith('system:');

/** i18n key for an audit action such as "batch.open" (in the namespace of the object's timeline). */
export const auditActionKey = (action: string) => `timeline.actions.${action.replace(/\./g, '_')}`;

/** The timeline of a batch or a vendor order (oldest first, as the server sends it), with load more. */
export function AuditTimeline({ audit, format, emptyTitle }: { audit: UseInfiniteQueryResult<InfiniteData<Page<AuditEvent>>>; format: AuditFormat; emptyTitle: string }) {
  const { t } = useTranslation();
  if (audit.isPending) return <ListSkeleton />;
  if (audit.error) return <ErrorAlert error={audit.error} />;
  const events = audit.data?.pages.flatMap((p) => p.items) ?? [];
  if (events.length === 0) return <Card.Root size="sm"><Card.Body><EmptyState icon={<LuHistory />} title={emptyTitle} /></Card.Body></Card.Root>;
  return (
    <Stack gap="4">
      <Timeline.Root size="sm">
        {events.map((ev) => {
          const detail = format.detail?.(ev);
          return (
            <Timeline.Item key={ev.id}>
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator />
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title>{format.title(ev)}</Timeline.Title>
                {detail && <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">{detail}</Text>}
                {ev.comment && <Text textStyle="sm" color="fg.muted" whiteSpace="pre-wrap">“{ev.comment}”</Text>}
                <Timeline.Description>{format.actor(ev.actor)} · {shortDate(ev.at)}</Timeline.Description>
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
      {audit.hasNextPage && (
        <HStack>
          <Button size="sm" variant="outline" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t('actions.loadMore')}</Button>
        </HStack>
      )}
    </Stack>
  );
}
