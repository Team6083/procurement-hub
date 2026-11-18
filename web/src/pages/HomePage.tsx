import { Badge, Box, Button, Card, HStack, Icon, Separator, Stack, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader, SectionHeader } from '@team6083/ui';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuChevronRight, LuPlus, LuUsers } from 'react-icons/lu';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import { ErrorAlert } from '../components/ErrorAlert';
import { RouteAnchor } from '../components/RouteLinks';
import { MyTasksCard } from '../features/batches/MyTasksCard';
import { CreateTeamModal } from '../features/teams/CreateTeamModal';
import { RoleBadge } from '../features/teams/RoleBadges';
import { paths } from '../paths';
import { ListSkeleton } from '../components/PageStates';

export function HomePage() {
  const { t } = useTranslation('teams');
  const { memberships, isSystemAdmin } = useMe();
  const teams = useTeams();
  const [creating, setCreating] = useState(false);
  const roleOf = (id: string) => memberships.find((m) => m.teamId === id)?.role;

  return (
    <Stack gap="6">
      <Box>
        <PageHeader title={t('common:pages.home')} />
        <MyTasksCard />
      </Box>

      <Box as="section">
        <SectionHeader
          title={t('home.teams.title')}
          count={teams.data?.length}
          actions={
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
        {teams.data && (
          <Card.Root size="sm">
            <Card.Body py="2">
              {teams.data.length === 0 && (
                <EmptyState icon={<LuUsers />} title={t('home.teams.empty')} description={t('home.teams.emptyBody')} />
              )}
              {teams.data.map((team, index) => {
                const role = roleOf(team.id);
                return (
                  <Fragment key={team.id}>
                    {index > 0 && <Separator />}
                    <HStack position="relative" justify="space-between" gap="3" py="2" _hover={{ bg: 'bg.muted' }}>
                      <Stack gap="0" minW="0">
                        <RouteAnchor
                          to={paths.team(team.slug)}
                          fontWeight="medium"
                          // The link's click area covers the whole row, so the arrow is clickable too.
                          _after={{ content: '""', position: 'absolute', inset: 0 }}
                        >
                          {team.name}
                        </RouteAnchor>
                        {team.description && (
                          <Text textStyle="sm" color="fg.muted" lineClamp={1}>
                            {team.description}
                          </Text>
                        )}
                      </Stack>
                      <HStack gap="2" flexShrink={0}>
                        {team.archived && <Badge colorPalette="gray">{t('home.teams.archived')}</Badge>}
                        {role && <RoleBadge role={role} />}
                        <Icon color="fg.muted" aria-hidden>
                          <LuChevronRight />
                        </Icon>
                      </HStack>
                    </HStack>
                  </Fragment>
                );
              })}
            </Card.Body>
          </Card.Root>
        )}
      </Box>
      {isSystemAdmin && <CreateTeamModal open={creating} onClose={() => setCreating(false)} />}
    </Stack>
  );
}
