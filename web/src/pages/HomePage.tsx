import { Badge, Button, Card, HStack, SimpleGrid, Stack } from '@chakra-ui/react';
import { EmptyState, TitleBar } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuUsers } from 'react-icons/lu';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import { ErrorAlert } from '../components/ErrorAlert';
import { ListSkeleton } from '../components/PageStates';
import { RouteAnchor } from '../components/RouteLinks';
import { MyTasksCard } from '../features/batches/MyTasksCard';
import { CreateTeamModal } from '../features/teams/CreateTeamModal';
import { RoleBadge } from '../features/teams/RoleBadges';
import { paths } from '../paths';

export function HomePage() {
  const { t } = useTranslation('teams');
  const { memberships, isSystemAdmin } = useMe();
  const teams = useTeams();
  const [creating, setCreating] = useState(false);
  const roleOf = (id: string) => memberships.find((m) => m.teamId === id)?.role;

  return (
    <Stack gap="6">
      <TitleBar level={1} title={t('common:pages.home')} />

      <MyTasksCard />

      <Stack gap="2">
        <TitleBar
          level={2}
          title={t('home.teams.title')}
          after={teams.data && <Badge>{teams.data.length}</Badge>}
          end={
            isSystemAdmin && (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <LuPlus />
                {t('home.createTeam')}
              </Button>
            )
          }
        />

        {teams.isPending && <ListSkeleton rows={2} />}
        {teams.error && <ErrorAlert error={teams.error} />}

        {teams.data?.length === 0 && (
          <EmptyState icon={<LuUsers />} title={t('home.teams.empty')} description={t('home.teams.emptyBody')} />
        )}

        {!!teams.data?.length && (
          <SimpleGrid minChildWidth="18rem" gap="3">
            {teams.data.map((team) => {
              const role = roleOf(team.id);
              return (
                <Card.Root key={team.id} size="sm">
                  <Card.Body gap="2">
                    <HStack gap="2">
                      <Card.Title><RouteAnchor to={paths.team(team.slug)}>{team.name}</RouteAnchor></Card.Title>
                      {(team.archived || role) && (
                        <HStack gap="2">
                          {team.archived && <Badge colorPalette="gray">{t('home.teams.archived')}</Badge>}
                          {role && <RoleBadge role={role} />}
                        </HStack>
                      )}
                    </HStack>

                    {team.description && <Card.Description lineClamp={2}>{team.description}</Card.Description>}
                  </Card.Body>
                </Card.Root>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>

      {isSystemAdmin && <CreateTeamModal open={creating} onClose={() => setCreating(false)} />}
    </Stack>
  );
}
