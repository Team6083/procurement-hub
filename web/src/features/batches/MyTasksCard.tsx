import { Badge, Card, HStack, Stack, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuCircleCheckBig } from 'react-icons/lu';
import { useMyTasks } from '../../api/batches';
import type { Batch } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { ListSkeleton } from '../../components/PageStates';

/** A link to a batch with what waits there as a badge beside it, not in parentheses inside the link. */
function BatchTask({ batch, badge }: { batch: Batch; badge?: string }) {
  return (
    <HStack gap="2" wrap="wrap">
      <RouteAnchor to={paths.batch(batch.id)}>#{batch.number} {batch.title}</RouteAnchor>
      {badge && <Badge variant="subtle" colorPalette="orange" fontVariantNumeric="tabular-nums">{badge}</Badge>}
    </HStack>
  );
}

/** One kind of task: its title and count, then a card of links. */
function TaskGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <Stack gap="2">
      <SectionHeader as="h3" title={title} count={count} mb="0" />
      <Card.Root size="sm">
        <Card.Body gap="2" alignItems="flex-start">
          {children}
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

/** A task that is only a count (purchasing and receiving work): one link to where it is done. */
function CountGroup({ title, link, count, to }: { title: string; link: string; count: number | undefined; to: string }) {
  return (
    <TaskGroup title={title} count={count ?? 0}>
      <RouteAnchor to={to}>{link}</RouteAnchor>
    </TaskGroup>
  );
}

/**
 * The home page's tasks: batch work (proposals, reviews, returned items) and, for purchasers and receivers, the
 * purchasing and receiving work. The page header already says 首頁, so the groups carry no title of their own.
 */
export function MyTasksCard() {
  const { t } = useTranslation('teams');
  const { t: tb } = useTranslation('batches');
  const tasks = useMyTasks();
  const d = tasks.data;
  const proposals = d?.proposalsToHandle ?? [];
  const review = d?.itemsToReview ?? [];
  const returned = d?.returnedItems ?? [];
  const confirm = d?.reviewsToConfirm ?? [];
  const purchase = d?.itemsToPurchase ?? [];
  const counts = [d?.draftVendorOrders?.count, d?.openProblems?.count, d?.linesToClose?.count, d?.deliveriesToMatch?.count];
  const empty = proposals.length + review.length + returned.length + confirm.length + purchase.length + counts.reduce<number>((n, c) => n + (c ?? 0), 0) === 0;

  if (tasks.isPending) return <ListSkeleton rows={3} />;
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
        {proposals.map((x) => <BatchTask key={x.batch.id} batch={x.batch} />)}
      </TaskGroup>
      <TaskGroup title={tb('tasks.review')} count={review.length}>
        {review.map((x) => <BatchTask key={x.batch.id} batch={x.batch} badge={tb('tasks.pendingCount', { count: x.count })} />)}
      </TaskGroup>
      <TaskGroup title={tb('tasks.returned')} count={returned.length}>
        {returned.map((i) => (
          <Stack key={i.id} gap="0">
            <RouteAnchor to={paths.batch(i.batchId)}>#{i.seqNo} {i.name}</RouteAnchor>
            {i.review?.comment && <Text textStyle="sm" color="fg.muted">{i.review.comment}</Text>}
          </Stack>
        ))}
      </TaskGroup>
      <TaskGroup title={tb('tasks.confirm')} count={confirm.length}>
        {confirm.map((x) => <BatchTask key={x.batch.id} batch={x.batch} badge={tb('tasks.confirmCount', { count: x.count })} />)}
      </TaskGroup>
      <TaskGroup title={tb('tasks.purchase')} count={purchase.length}>
        {purchase.map((v) => (
          <HStack key={v.vendor ?? ''} gap="2" wrap="wrap">
            <RouteAnchor to={paths.purchasing}>{v.vendor ?? tb('tasks.noVendor')}</RouteAnchor>
            <Badge variant="subtle" colorPalette="orange" fontVariantNumeric="tabular-nums">{tb('tasks.purchaseCount', { count: v.count })}</Badge>
            {v.myBatches > 0 && <Badge variant="outline" fontVariantNumeric="tabular-nums">{tb('tasks.purchaseMine', { count: v.myBatches })}</Badge>}
          </HStack>
        ))}
      </TaskGroup>
      <CountGroup title={tb('tasks.draftOrders')} link={tb('tasks.draftOrdersLink')} count={d?.draftVendorOrders?.count} to={`${paths.vendorOrders}?status=draft`} />
      <CountGroup title={tb('tasks.problems')} link={tb('tasks.problemsLink')} count={d?.openProblems?.count} to={paths.receiving} />
      <CountGroup title={tb('tasks.linesToClose')} link={tb('tasks.linesToCloseLink')} count={d?.linesToClose?.count} to={paths.vendorOrders} />
      <CountGroup title={tb('tasks.deliveriesToMatch')} link={tb('tasks.deliveriesToMatchLink')} count={d?.deliveriesToMatch?.count} to={paths.receiving} />
    </Stack>
  );
}
