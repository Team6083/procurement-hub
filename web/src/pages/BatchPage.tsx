import { Alert, Badge, Button, Card, HStack, Stack, Tabs, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { FactList, TitleBar } from '@team6083/ui';
import { LuPencil } from 'react-icons/lu';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useBatch, useItems } from '../api/batches';
import { useMe } from '../api/me';
import { useTeam } from '../api/teams';
import { isFullTeam } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { paths } from '../paths';
import { BatchActions } from '../features/batches/BatchActions';
import { EditBatchModal } from '../features/batches/EditBatchModal';
import { ItemsTab } from '../features/batches/ItemsTab';
import { PurchasingTab } from '../features/batches/PurchasingTab';
import { BatchStatusBadge } from '../features/batches/StatusBadges';
import { TimelineTab } from '../features/batches/TimelineTab';
import { callerFor, canEditBatch, isMember } from '../features/batches/rules';
import { useNames } from '../features/batches/useNames';
import { shortDate } from '../features/dates';
import { PageSkeleton, LoadError, ListSkeleton } from '../components/PageStates';

export function BatchPage() {
  const { t } = useTranslation('batches');
  const { id } = useParams();
  const { me } = useMe();
  const batchQ = useBatch(id);
  const batch = batchQ.data;
  const teamQ = useTeam(batch?.teamId);
  const items = useItems(id);
  const teamData = teamQ.data;
  const full = teamData && isFullTeam(teamData) ? teamData : undefined;
  const caller = callerFor(me, batch?.teamId ?? '', teamData?.archived ?? false);
  const internals = isMember(caller) || caller.isSystemAdmin;
  const names = useNames(batch?.teamId, internals);
  const [editing, setEditing] = useState(false);

  if (batchQ.isPending) return <PageSkeleton />;
  if (batchQ.error || !batch) return <LoadError error={batchQ.error} />;

  const list = items.data ?? [];
  const pendingItems = items.data ? list.filter((i) => i.status === 'pending').length : undefined;
  const undecidedItems = items.data ? list.filter((i) => i.status === 'pending' || i.status === 'returned').length : undefined;
  const visibility = batch.visibilityOverride || full?.visibility;
  const who = (ids: string[]) => (ids.length ? ids.map(names.name).join(', ') : t('assignments.none'));
  const defaultSubgroupId = me?.memberships.find((m) => m.teamId === batch.teamId)?.defaultSubgroupId ?? '';

  return (
    <Stack gap="6">
      <Stack gap="4">
        <TitleBar level={1} title={`#${batch.number} ${batch.title}`} after={
            <HStack gap="2">
              <BatchStatusBadge status={batch.status} />
              {batch.origin === 'proposed' && <Badge variant="outline">{t('header.proposed')}</Badge>}
            </HStack>
          } description={teamData && <RouteAnchor to={paths.team(teamData.slug)} color="fg.muted">{teamData.name}</RouteAnchor>} end={
            // Top-aligned: BatchActions can grow a "why disabled" line under its buttons, and the edit button must stay on the button row.
            <HStack gap="2" wrap="wrap" align="flex-start" justify="flex-end">
              {canEditBatch(batch, caller) && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <LuPencil />
                  {t('edit.button')}
                </Button>
              )}
              <BatchActions batch={batch} caller={caller} pendingItems={pendingItems} undecidedItems={undecidedItems} items={items.data} />
            </HStack>
          } />
        {batch.description && <Text whiteSpace="pre-wrap">{batch.description}</Text>}
        {batch.statusReason && (
          <Alert.Root status="neutral">
            <Alert.Indicator />
            <Alert.Description>{t('header.reason', { reason: batch.statusReason })}</Alert.Description>
          </Alert.Root>
        )}
        <Card.Root size="sm">
          <Card.Body>
            <FactList
              minChildWidth={{ base: '9rem', md: '12rem' }}
              items={[
                { label: t('header.deadline'), value: shortDate(batch.deadline) },
                { label: t('header.visibility'), value: visibility ? t(`visibility.${visibility}`) : '—' },
                { label: t('assignments.approvers'), value: who(batch.assignments.approvers) },
                { label: t('assignments.purchasers'), value: who(batch.assignments.purchasers) },
              ]}
            />
          </Card.Body>
        </Card.Root>
      </Stack>

      <Tabs.Root defaultValue="items" lazyMount unmountOnExit>
        <Tabs.List>
          <Tabs.Trigger value="items">{t('tabs.items')}</Tabs.Trigger>
          <Tabs.Trigger value="purchasing">{t('tabs.purchasing')}</Tabs.Trigger>
          <Tabs.Trigger value="timeline">{t('tabs.timeline')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="items">
          {items.isPending && <ListSkeleton />}
          {items.error && <ErrorAlert error={items.error} />}
          {items.data && <ItemsTab batch={batch} team={full} caller={caller} items={list} nameOf={names.name} defaultSubgroupId={defaultSubgroupId} />}
        </Tabs.Content>
        <Tabs.Content value="purchasing">
          {items.isPending && <ListSkeleton />}
          {items.error && <ErrorAlert error={items.error} />}
          {items.data && <PurchasingTab batch={batch} items={list} />}
        </Tabs.Content>
        <Tabs.Content value="timeline">
          <TimelineTab batchId={batch.id} nameOf={names.name} />
        </Tabs.Content>
      </Tabs.Root>
      {canEditBatch(batch, caller) && <EditBatchModal open={editing} batch={batch} members={names.members} onClose={() => setEditing(false)} />}
    </Stack>
  );
}
