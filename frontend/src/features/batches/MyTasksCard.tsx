import { Card, Loader, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useMyTasks } from '../../api/batches';
import type { Batch } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { RouteAnchor } from '../../components/RouteLinks';

interface TaskLike { Batch?: Batch; Count?: number; batch?: Batch; count?: number }
/** GET /me/tasks serialises BatchTask with capitalised keys; accept lower-case too in case the backend adds tags. */
export function taskBatch(t: TaskLike): Batch | undefined {
  return t.Batch ?? t.batch;
}
export function taskCount(t: TaskLike): number {
  return t.Count ?? t.count ?? 0;
}

/** "My tasks" on the home page: proposals to handle, items to review, returned items. */
export function MyTasksCard() {
  const { t } = useTranslation('teams');
  const { t: tb } = useTranslation('batches');
  const tasks = useMyTasks();
  const d = tasks.data;
  const proposals = (d?.proposalsToHandle ?? []) as TaskLike[];
  const review = (d?.itemsToReview ?? []) as TaskLike[];
  const returned = d?.returnedItems ?? [];
  const empty = proposals.length + review.length + returned.length === 0;
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>{t('home.myTasks.title')}</Text>
        {tasks.isPending && <Loader size="sm" />}
        {tasks.error && <ErrorAlert error={tasks.error} />}
        {d && empty && <Text c="dimmed">{tb('tasks.empty')}</Text>}
        {proposals.length > 0 && <Text size="sm" fw={500}>{tb('tasks.proposals')}</Text>}
        {proposals.map((x) => {
          const b = taskBatch(x);
          return b && <RouteAnchor key={b.id} href={`/batches/${b.id}`} size="sm">#{b.number} {b.title}</RouteAnchor>;
        })}
        {review.length > 0 && <Text size="sm" fw={500}>{tb('tasks.review')}</Text>}
        {review.map((x) => {
          const b = taskBatch(x);
          return b && <RouteAnchor key={b.id} href={`/batches/${b.id}`} size="sm">#{b.number} {b.title} ({tb('tasks.pendingCount', { count: taskCount(x) })})</RouteAnchor>;
        })}
        {returned.length > 0 && <Text size="sm" fw={500}>{tb('tasks.returned')}</Text>}
        {returned.map((i) => (
          <RouteAnchor key={i.id} href={`/batches/${i.batchId}`} size="sm">
            #{i.seqNo} {i.name}{i.review?.comment ? ` — ${i.review.comment}` : ''}
          </RouteAnchor>
        ))}
      </Stack>
    </Card>
  );
}
