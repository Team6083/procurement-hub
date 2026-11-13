import { Badge, Button, Card, Flex, Heading, HStack, Spinner, Stack, Text, useDisclosure } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import { RouteAnchor } from '../components/RouteLinks';
import { paths } from '../paths';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { CreateTeamModal } from '../features/teams/CreateTeamModal';
import { MyTasksCard } from '../features/batches/MyTasksCard';
import { RoleBadge } from '../features/teams/RoleBadges';

export function HomePage() {
  const { t } = useTranslation('teams');
  const { memberships, isSystemAdmin } = useMe();
  const teams = useTeams();
  const { open: opened, onOpen: open, onClose: close } = useDisclosure();
  const roleOf = (id: string) => memberships.find((m) => m.teamId === id)?.role;

  return (
    <Stack gap="4">
      <Heading as="h2" size="xl">{t('common:pages.home')}</Heading>
      <MyTasksCard />
      <Card.Root variant="outline">
        <Card.Body p="4">
          <Stack gap="3">
            <Flex justify="space-between" align="center" gap="3" wrap="wrap">
              <Text fontWeight="semibold">{t('home.teams.title')}</Text>
              {isSystemAdmin && <Button size="sm" onClick={open}>{t('home.createTeam')}</Button>}
            </Flex>
            {teams.isPending && <Spinner size="sm" />}
            {teams.error && <ErrorAlert error={teams.error} />}
            {teams.data?.length === 0 && <Notice>{t('home.teams.empty')}</Notice>}
            {teams.data?.map((team) => {
              const role = roleOf(team.id);
              return (
                <Flex key={team.id} justify="space-between" align="center" gap="3">
                  <Stack gap="0" minW="0">
                    <RouteAnchor to={paths.team(team.slug)} fontWeight="medium">
                      {team.name}
                    </RouteAnchor>
                    {team.description && <Text fontSize="sm" color="fg.muted" lineClamp={1}>{team.description}</Text>}
                  </Stack>
                  <HStack gap="2" flexShrink={0}>
                    {team.archived && <Badge colorPalette="gray">{t('home.teams.archived')}</Badge>}
                    {role && <RoleBadge role={role} />}
                  </HStack>
                </Flex>
              );
            })}
          </Stack>
        </Card.Body>
      </Card.Root>
      {isSystemAdmin && <CreateTeamModal opened={opened} onClose={close} />}
    </Stack>
  );
}
