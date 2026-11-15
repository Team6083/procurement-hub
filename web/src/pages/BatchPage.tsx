import { Badge, Button, Card, HStack, Skeleton, Stack, Tabs, Text, useDisclosure } from '@chakra-ui/react';
import { FactList, PageHeader } from '@team6083/ui';
import { LuPencil } from 'react-icons/lu';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useBatch, useItems } from '../api/batches';
import { useMe } from '../api/me';
import { useTeam } from '../api/teams';
import { isFullTeam } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { paths } from '../paths';
import { BatchActions } from '../features/batches/BatchActions';
import { EditBatchModal } from '../features/batches/EditBatchModal';
import { ItemsTab } from '../features/batches/ItemsTab';
import { BatchStatusBadge } from '../features/batches/StatusBadges';
import { TimelineTab } from '../features/batches/TimelineTab';
import { OrdersTab } from '../features/orders/OrdersTab';
import { canSeeOrders } from '../features/orders/rules';
import { ReceivingTab } from '../features/receiving/ReceivingTab';
import { canSeeReceiving } from '../features/receiving/rules';
import { callerFor, canEditBatch, isMember } from '../features/batches/rules';
import { useNames } from '../features/batches/useNames';
import { shortDate } from '../features/dates';

export function BatchPage() {
  const { t } = useTranslation('batches');
  const { id } = useParams();
  const { me } = useMe();
  const batchQ = useBatch(id);
  const batch = batchQ.data?.data;
  const teamQ = useTeam(batch?.teamId);
  const items = useItems(id);
  const teamData = teamQ.data?.data;
  const full = teamData && isFullTeam(teamData) ? teamData : undefined;
  const caller = callerFor(me, batch?.teamId ?? '', teamData?.archived ?? false);
  const internals = isMember(caller) || caller.isSystemAdmin;
  const names = useNames(batch?.teamId, internals);
  const { open: editing, onOpen: open, onClose: close } = useDisclosure();

  if (batchQ.isPending) return <Skeleton h="32" rounded="l3" />;
  if (batchQ.error || !batch) return <ErrorAlert error={batchQ.error} />;

  const list = items.data ?? [];
  const pendingItems = items.data ? list.filter((i) => i.status === 'pending').length : undefined;
  const visibility = batch.visibilityOverride || full?.visibility;
  const who = (ids: string[]) => (ids.length ? ids.map(names.name).join(', ') : t('assignments.none'));
  const defaultSubgroupId = me?.memberships.find((m) => m.teamId === batch.teamId)?.defaultSubgroupId ?? '';

  return (
    <Stack gap="4">
      <PageHeader
        mb="0"
        title={`#${batch.number} ${batch.title}`}
        badge={
          <HStack gap="2">
            <BatchStatusBadge status={batch.status} />
            {batch.origin === 'proposed' && <Badge variant="outline">{t('header.proposed')}</Badge>}
          </HStack>
        }
        description={teamData && <RouteAnchor to={paths.team(teamData.slug)} color="fg.muted">{teamData.name}</RouteAnchor>}
        actions={
          <HStack wrap="wrap">
            {canEditBatch(batch, caller) && (
              <Button size="sm" variant="outline" onClick={open}>
                <LuPencil />
                {t('edit.button')}
              </Button>
            )}
            <BatchActions batch={batch} caller={caller} pendingItems={pendingItems} />
          </HStack>
        }
      />
      {batch.description && <Text whiteSpace="pre-wrap">{batch.description}</Text>}
      {batch.statusReason && <Notice>{t('header.reason', { reason: batch.statusReason })}</Notice>}
      <Card.Root size="sm">
        <Card.Body>
          <FactList
            minChildWidth={{ base: '9rem', md: '12rem' }}
            items={[
              { label: t('header.deadline'), value: shortDate(batch.deadline) },
              { label: t('header.visibility'), value: visibility ? t(`visibility.${visibility}`) : '—' },
              { label: t('assignments.approvers'), value: who(batch.assignments.approvers) },
              { label: t('assignments.purchasers'), value: who(batch.assignments.purchasers) },
              { label: t('assignments.receivers'), value: who(batch.assignments.receivers) },
            ]}
          />
        </Card.Body>
      </Card.Root>

      <Tabs.Root defaultValue="items" lazyMount unmountOnExit>
        <Tabs.List overflowX="auto">
          <Tabs.Trigger value="items">{t('tabs.items')}</Tabs.Trigger>
          {canSeeOrders(caller) && <Tabs.Trigger value="orders">{t('tabs.orders')}</Tabs.Trigger>}
          {canSeeReceiving(batch, caller) && <Tabs.Trigger value="receiving">{t('tabs.receiving')}</Tabs.Trigger>}
          <Tabs.Trigger value="timeline">{t('tabs.timeline')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="items">
          {items.isPending && <Skeleton h="24" rounded="l3" />}
          {items.error && <ErrorAlert error={items.error} />}
          {items.data && <ItemsTab batch={batch} team={full} caller={caller} items={list} nameOf={names.name} defaultSubgroupId={defaultSubgroupId} />}
        </Tabs.Content>
        {canSeeOrders(caller) && (
          <Tabs.Content value="orders">
            {items.data && <OrdersTab batch={batch} caller={caller} items={list} />}
          </Tabs.Content>
        )}
        {canSeeReceiving(batch, caller) && (
          <Tabs.Content value="receiving">
            {items.data && <ReceivingTab batch={batch} caller={caller} items={list} nameOf={names.name} />}
          </Tabs.Content>
        )}
        <Tabs.Content value="timeline">
          <TimelineTab batchId={batch.id} nameOf={names.name} />
        </Tabs.Content>
      </Tabs.Root>
      {canEditBatch(batch, caller) && <EditBatchModal opened={editing} batch={batch} members={names.members} onClose={close} />}
    </Stack>
  );
}
