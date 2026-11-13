import { Alert, Badge, Button, Card, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
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
import { ReviewTab } from '../features/batches/ReviewTab';
import { BatchStatusBadge } from '../features/batches/StatusBadges';
import { TimelineTab } from '../features/batches/TimelineTab';
import { callerFor, canEditBatch, isMember } from '../features/batches/rules';
import { useNames } from '../features/batches/useNames';

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
  const [editing, { open, close }] = useDisclosure(false);

  if (batchQ.isPending) return <Loader />;
  if (batchQ.error || !batch) return <ErrorAlert error={batchQ.error} />;

  const list = items.data ?? [];
  const pendingItems = items.data ? list.filter((i) => i.status === 'pending').length : undefined;
  const visibility = batch.visibilityOverride || full?.visibility;
  const who = (ids: string[]) => (ids.length ? ids.map(names.name).join(', ') : t('assignments.none'));
  const defaultSubgroupId = me?.memberships.find((m) => m.teamId === batch.teamId)?.defaultSubgroupId ?? '';

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group>
            <Title order={2}>#{batch.number} {batch.title}</Title>
            <BatchStatusBadge status={batch.status} />
          </Group>
          {teamData && <RouteAnchor to={paths.team(teamData.slug)} size="sm">{teamData.name}</RouteAnchor>}
        </Stack>
        <Group>
          {canEditBatch(batch, caller) && <Button size="xs" variant="default" onClick={open}>{t('edit.button')}</Button>}
          <BatchActions batch={batch} caller={caller} pendingItems={pendingItems} />
        </Group>
      </Group>
      {batch.description && <Text>{batch.description}</Text>}
      {batch.statusReason && <Alert color="gray">{t('header.reason', { reason: batch.statusReason })}</Alert>}
      <Card withBorder>
        <Group gap="xl" align="flex-start">
          <Stack gap={0}>
            <Text size="xs" c="dimmed">{t('header.deadline')}</Text>
            <Text size="sm">{batch.deadline ? new Date(batch.deadline).toLocaleString() : '—'}</Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">{t('header.visibility')}</Text>
            <Text size="sm">{visibility ? t(`visibility.${visibility}`) : '—'}</Text>
          </Stack>
          <Stack gap={0}><Text size="xs" c="dimmed">{t('assignments.approvers')}</Text><Text size="sm">{who(batch.assignments.approvers)}</Text></Stack>
          <Stack gap={0}><Text size="xs" c="dimmed">{t('assignments.purchasers')}</Text><Text size="sm">{who(batch.assignments.purchasers)}</Text></Stack>
          <Stack gap={0}><Text size="xs" c="dimmed">{t('assignments.receivers')}</Text><Text size="sm">{who(batch.assignments.receivers)}</Text></Stack>
          {batch.origin === 'proposed' && <Badge variant="outline">{t('header.proposed')}</Badge>}
        </Group>
      </Card>

      <Tabs defaultValue="items" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="items">{t('tabs.items')}</Tabs.Tab>
          {internals && <Tabs.Tab value="review">{t('tabs.review')}</Tabs.Tab>}
          <Tabs.Tab value="timeline">{t('tabs.timeline')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="items" pt="md">
          {items.isPending && <Loader />}
          {items.error && <ErrorAlert error={items.error} />}
          {items.data && <ItemsTab batch={batch} team={full} caller={caller} items={list} nameOf={names.name} defaultSubgroupId={defaultSubgroupId} />}
        </Tabs.Panel>
        {internals && (
          <Tabs.Panel value="review" pt="md">
            {items.data && <ReviewTab batch={batch} team={full} caller={caller} items={list} nameOf={names.name} />}
          </Tabs.Panel>
        )}
        <Tabs.Panel value="timeline" pt="md">
          <TimelineTab batchId={batch.id} nameOf={names.name} />
        </Tabs.Panel>
      </Tabs>
      {canEditBatch(batch, caller) && <EditBatchModal opened={editing} batch={batch} members={names.members} onClose={close} />}
    </Stack>
  );
}
