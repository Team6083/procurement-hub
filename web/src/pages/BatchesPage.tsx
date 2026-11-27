import { Button, HStack, Stack } from '@chakra-ui/react';
import { EmptyState, FilterBar, TitleBar } from '@team6083/ui';
import { LuPackage, LuPlus } from 'react-icons/lu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBatchList } from '../api/batches';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import type { BatchStatus } from '../api/types';
import { FilterSelect } from '../components/FilterSelect';
import { ErrorAlert } from '../components/ErrorAlert';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { CreateBatchModal } from '../features/batches/CreateBatchModal';
import { BatchTable } from '../features/batches/BatchTable';
import { ListSkeleton } from '../components/PageStates';

const BATCH_STATUSES: BatchStatus[] = ['proposed', 'proposal_rejected', 'draft', 'collecting', 'reviewing', 'purchasing', 'receiving', 'completed', 'cancelled'];

export function BatchesPage() {
  const { t } = useTranslation('batches');
  const { memberships } = useMe();
  const teams = useTeams();
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const q = useDebouncedValue(text, 300);
  const [creating, setCreating] = useState(false);
  const list = useBatchList({ teamId: teamId || undefined, status: status || undefined, q });
  const batches = list.data?.pages.flatMap((p) => p.items) ?? [];
  const teamName = (id: string) => (teams.data ? teams.data.find((x) => x.id === id)?.name ?? t('common:unknownTeam') : '');
  const mine = memberships.filter((m) => !teams.data?.find((x) => x.id === m.teamId)?.archived);
  const canCreate = mine.length > 0;
  const anyAdmin = mine.some((m) => m.role === 'admin');

  return (
    <Stack gap="4">
      <TitleBar level={1} title={t('list.title')} end={
          canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <LuPlus />
              {anyAdmin ? t('list.new') : t('list.propose')}
            </Button>
          )
        } />
      <FilterBar
        mb="0"
        search={{ value: text, onChange: setText, placeholder: t('filters.text') }}
        activeCount={[teamId, status].filter(Boolean).length}
        onClear={() => { setTeamId(''); setStatus(''); }}
      >
        <FilterSelect label={t('filters.team')} value={teamId} onChange={setTeamId} allLabel={t('filters.all')} options={(teams.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <FilterSelect label={t('filters.status')} value={status} onChange={setStatus} allLabel={t('filters.all')} options={BATCH_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
      </FilterBar>
      {list.isPending && <ListSkeleton />}
      {list.error && <ErrorAlert error={list.error} />}
      {list.data && <BatchTable batches={batches} teamName={teamName} empty={<EmptyState icon={<LuPackage />} title={t('list.empty')} />} />}
      {list.hasNextPage && (
        <HStack>
          <Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
      <CreateBatchModal open={creating} onClose={() => setCreating(false)} teams={mine} defaultTeamId={teamId && mine.some((m) => m.teamId === teamId) ? teamId : undefined} />
    </Stack>
  );
}
