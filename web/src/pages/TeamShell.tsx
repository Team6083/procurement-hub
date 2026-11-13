import { Alert, Badge, Group, Loader, Stack, Tabs, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useMe } from '../api/me';
import { useTeam, useTeams } from '../api/teams';
import { isFullTeam } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { TeamContext } from '../features/teams/TeamContext';
import { canAdminTeam, isTeamMember } from '../features/teams/roles';
import { paths } from '../paths';

type TabKey = 'overview' | 'members' | 'settings';

export function TeamShell() {
  const { t } = useTranslation('teams');
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
    void navigate(paths.team(slug, tab === 'members' || tab === 'settings' ? tab : ''));
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
