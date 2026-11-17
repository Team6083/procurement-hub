import { Button, Card, HStack, List, Skeleton, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { EmptyState, FactList, SectionHeader } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuPackage, LuPlus } from 'react-icons/lu';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { ErrorAlert } from '../components/ErrorAlert';
import { BatchTable } from '../features/batches/BatchTable';
import { CreateBatchModal } from '../features/batches/CreateBatchModal';
import { useTeamCtx } from '../features/teams/TeamContext';

export function TeamOverview() {
  const { t } = useTranslation('teams');
  const { t: tb } = useTranslation('batches');
  const { team, full } = useTeamCtx();
  const { memberships } = useMe();
  const membership = memberships.find((m) => m.teamId === team.id);
  const list = useBatchList({ teamId: team.id });
  const batches = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [creating, setCreating] = useState(false);
  const active = full?.subgroups.filter((g) => g.active) ?? [];
  return (
    <Stack gap="6">
      {team.description ? <Text whiteSpace="pre-wrap">{team.description}</Text> : <Text color="fg.muted">{t('team.noDescription')}</Text>}
      {full && (
        <Card.Root size="sm">
          <Card.Body>
            <FactList
              minChildWidth={{ base: '9rem', md: '12rem' }}
              items={[
                { label: t('general.visibility'), value: t(`team.visibility.${full.visibility}`) },
                { label: t('general.locale'), value: t(`common:language.${full.locale}`) },
                {
                  label: t('team.subgroups'),
                  value: active.length === 0 ? (
                    <Text color="fg.muted">{t('team.noSubgroups')}</Text>
                  ) : (
                    <List.Root ps="4">
                      {active.map((g) => <List.Item key={g.id}>{g.name}</List.Item>)}
                    </List.Root>
                  ),
                },
              ]}
            />
          </Card.Body>
        </Card.Root>
      )}
      <Stack gap="2">
        <SectionHeader
          title={t('common:pages.batches')}
          mb="0"
          actions={
            membership && !team.archived && (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <LuPlus />
                {membership.role === 'admin' ? tb('list.new') : tb('list.propose')}
              </Button>
            )
          }
        />
        {list.isPending && <Skeleton h="24" rounded="l3" />}
        {list.error && <ErrorAlert error={list.error} />}
        {list.data && batches.length === 0 && (
          <Card.Root size="sm">
            <Card.Body>
              <EmptyState icon={<LuPackage />} title={tb('list.empty')} />
            </Card.Body>
          </Card.Root>
        )}
        {batches.length > 0 && <BatchTable batches={batches} />}
        {list.hasNextPage && (
          <HStack>
            <Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{tb('list.loadMore')}</Button>
          </HStack>
        )}
      </Stack>
      {membership && <CreateBatchModal open={creating} onClose={() => setCreating(false)} teams={[membership]} />}
    </Stack>
  );
}
