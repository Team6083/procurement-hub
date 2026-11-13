import { Card, Spinner, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useMyTasks } from '../../api/batches';
import type { Batch } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';

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
    <Card.Root variant="outline">
      <Card.Body p="4">
        <Stack gap="2" align="flex-start">
          <Text fontWeight="semibold">{t('home.myTasks.title')}</Text>
          {tasks.isPending && <Spinner size="sm" />}
          {tasks.error && <ErrorAlert error={tasks.error} />}
          {d && empty && <Text color="fg.muted">{tb('tasks.empty')}</Text>}
          {proposals.length > 0 && <Text fontSize="sm" fontWeight="medium">{tb('tasks.proposals')}</Text>}
          {proposals.map((x) => {
            const b = taskBatch(x);
            return b && <RouteAnchor key={b.id} to={paths.batch(b.id)} fontSize="sm">#{b.number} {b.title}</RouteAnchor>;
          })}
          {review.length > 0 && <Text fontSize="sm" fontWeight="medium">{tb('tasks.review')}</Text>}
          {review.map((x) => {
            const b = taskBatch(x);
            return b && <RouteAnchor key={b.id} to={paths.batch(b.id)} fontSize="sm">#{b.number} {b.title} ({tb('tasks.pendingCount', { count: taskCount(x) })})</RouteAnchor>;
          })}
          {returned.length > 0 && <Text fontSize="sm" fontWeight="medium">{tb('tasks.returned')}</Text>}
          {returned.map((i) => (
            <RouteAnchor key={i.id} to={paths.batch(i.batchId)} fontSize="sm">
              #{i.seqNo} {i.name}{i.review?.comment ? ` — ${i.review.comment}` : ''}
            </RouteAnchor>
          ))}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
