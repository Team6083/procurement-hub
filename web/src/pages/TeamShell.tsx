import { Alert, Badge, Group, Loader, Stack, Tabs, Title } from '@mantine/core';
import { Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useTeam, useTeams } from '../api/teams';
import { isFullTeam } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { TeamContext } from '../features/teams/TeamContext';
import { canAdminTeam, isTeamMember } from '../features/teams/roles';

type TabKey = 'overview' | 'members' | 'settings';

export function TeamShell() {
  const { t } = useTranslation('teams');
  const { slug = '' } = useParams({ strict: false });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { me } = useMe();
  const teams = useTeams();
  const teamId = teams.data?.find((x) => x.slug === slug)?.id;
  const team = useTeam(teamId);

  if (teams.isPending || (teamId && team.isPending)) return <Loader />;
  if (teams.error) return <ErrorAlert error={teams.error} />;
  if (!teamId) return <Alert color="gray">{t('team.notFound')}</Alert>;
  if (team.error || !team.data) return <ErrorAlert error={team.error} />;

  const data = team.data.data;
  const full = isFullTeam(data) ? data : undefined;
  const canAdmin = !!full && canAdminTeam(me, teamId);
  const member = !!full && (isTeamMember(me, teamId) || !!me?.isSystemAdmin);
  const active: TabKey = pathname.includes('/settings') ? 'settings' : pathname.endsWith('/members') ? 'members' : 'overview';
  const go = (tab: string | null) => {
    if (tab === 'members') void navigate({ to: '/teams/$slug/members', params: { slug } });
    else if (tab === 'settings') void navigate({ to: '/teams/$slug/settings', params: { slug } });
    else void navigate({ to: '/teams/$slug', params: { slug } });
  };

  return (
    <TeamContext.Provider value={{ teamId, slug, team: data, full, canAdmin, isMember: member }}>
      <Stack>
        <Group>
          <Title order={2}>{data.name}</Title>
          {data.archived && <Badge color="gray">{t('team.archived')}</Badge>}
        </Group>
        <Tabs value={active} onChange={go}>
          <Tabs.List>
            <Tabs.Tab value="overview">{t('tabs.overview')}</Tabs.Tab>
            {member && <Tabs.Tab value="members">{t('tabs.members')}</Tabs.Tab>}
            {canAdmin && <Tabs.Tab value="settings">{t('tabs.settings')}</Tabs.Tab>}
          </Tabs.List>
        </Tabs>
        <Outlet />
      </Stack>
    </TeamContext.Provider>
  );
}
