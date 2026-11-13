import { Alert, Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useTeams } from '../api/teams';
import { RouteAnchor } from '../components/RouteLinks';
import { ErrorAlert } from '../components/ErrorAlert';
import { CreateTeamModal } from '../features/teams/CreateTeamModal';
import { MyTasksCard } from '../features/batches/MyTasksCard';
import { RoleBadge } from '../features/teams/RoleBadges';

export function HomePage() {
  const { t } = useTranslation('teams');
  const { memberships, isSystemAdmin } = useMe();
  const teams = useTeams();
  const [opened, { open, close }] = useDisclosure(false);
  const roleOf = (id: string) => memberships.find((m) => m.teamId === id)?.role;

  return (
    <Stack>
      <Title order={2}>{t('common:pages.home')}</Title>
      <MyTasksCard />
      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Text fw={600}>{t('home.teams.title')}</Text>
            {isSystemAdmin && <Button onClick={open}>{t('home.createTeam')}</Button>}
          </Group>
          {teams.isPending && <Loader size="sm" />}
          {teams.error && <ErrorAlert error={teams.error} />}
          {teams.data?.length === 0 && <Alert color="gray">{t('home.teams.empty')}</Alert>}
          {teams.data?.map((team) => {
            const role = roleOf(team.id);
            return (
              <Group key={team.id} justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                  <RouteAnchor href={`/teams/${team.slug}`} fw={500}>
                    {team.name}
                  </RouteAnchor>
                  {team.description && <Text size="sm" c="dimmed" lineClamp={1}>{team.description}</Text>}
                </Stack>
                <Group gap="xs" wrap="nowrap">
                  {team.archived && <Badge color="gray">{t('home.teams.archived')}</Badge>}
                  {role && <RoleBadge role={role} />}
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Card>
      {isSystemAdmin && <CreateTeamModal opened={opened} onClose={close} />}
    </Stack>
  );
}
