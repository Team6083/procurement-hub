import { Badge, Box, Button, Card, HStack, Icon, Separator, Skeleton, Stack, Text, useDisclosure } from '@chakra-ui/react';
import { EmptyState, PageHeader, SectionHeader } from '@team6083/ui';
import { Fragment } from 'react';
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

export function HomePage() {
  const { t } = useTranslation('teams');
  const { memberships, isSystemAdmin } = useMe();
  const teams = useTeams();
  const { open: opened, onOpen: open, onClose: close } = useDisclosure();
  const roleOf = (id: string) => memberships.find((m) => m.teamId === id)?.role;

  return (
    <Stack gap="8">
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
              <Button size="sm" variant="outline" onClick={open}>
                <LuPlus />
                {t('home.createTeam')}
              </Button>
            )
          }
        />
        {teams.isPending && <Skeleton h="16" rounded="l3" />}
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
                    <HStack justify="space-between" gap="3" py="2">
                      <Stack gap="0" minW="0">
                        <RouteAnchor to={paths.team(team.slug)} color="fg" fontWeight="medium">
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
      {isSystemAdmin && <CreateTeamModal opened={opened} onClose={close} />}
    </Stack>
  );
}
