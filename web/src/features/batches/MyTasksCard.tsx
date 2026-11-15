import { Card, Skeleton, Stack } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCircleCheckBig } from 'react-icons/lu';
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

/** One kind of task: its title and count, then a card of links. */
function TaskGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <Stack gap="0">
      <SectionHeader as="h3" title={title} count={count} mb="2" />
      <Card.Root size="sm">
        <Card.Body gap="2" alignItems="flex-start">
          {children}
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

/**
 * The home page's tasks: proposals to handle, items to review, returned items. The page header
 * already says 我的待辦, so the groups carry no title of their own.
 */
export function MyTasksCard() {
  const { t } = useTranslation('teams');
  const { t: tb } = useTranslation('batches');
  const tasks = useMyTasks();
  const d = tasks.data;
  const proposals = (d?.proposalsToHandle ?? []) as TaskLike[];
  const review = (d?.itemsToReview ?? []) as TaskLike[];
  const returned = d?.returnedItems ?? [];
  const empty = proposals.length + review.length + returned.length === 0;

  if (tasks.isPending) return <Skeleton h="24" rounded="l3" />;
  if (tasks.error) return <ErrorAlert error={tasks.error} />;
  if (empty) {
    return (
      <Card.Root size="sm">
        <Card.Body>
          <EmptyState icon={<LuCircleCheckBig />} title={t('home.myTasks.emptyTitle')} description={tb('tasks.empty')} />
        </Card.Body>
      </Card.Root>
    );
  }

  return (
    <Stack gap="5">
      <TaskGroup title={tb('tasks.proposals')} count={proposals.length}>
        {proposals.map((x) => {
          const b = taskBatch(x);
          return b && <RouteAnchor key={b.id} to={paths.batch(b.id)} color="fg">#{b.number} {b.title}</RouteAnchor>;
        })}
      </TaskGroup>
      <TaskGroup title={tb('tasks.review')} count={review.length}>
        {review.map((x) => {
          const b = taskBatch(x);
          return b && <RouteAnchor key={b.id} to={paths.batch(b.id)} color="fg">#{b.number} {b.title} ({tb('tasks.pendingCount', { count: taskCount(x) })})</RouteAnchor>;
        })}
      </TaskGroup>
      <TaskGroup title={tb('tasks.returned')} count={returned.length}>
        {returned.map((i) => (
          <RouteAnchor key={i.id} to={paths.batch(i.batchId)} color="fg">
            #{i.seqNo} {i.name}{i.review?.comment ? ` — ${i.review.comment}` : ''}
          </RouteAnchor>
        ))}
      </TaskGroup>
    </Stack>
  );
}
