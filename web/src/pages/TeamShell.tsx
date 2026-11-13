import { Badge, Heading, HStack, Spinner, Stack, Tabs } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useMe } from '../api/me';
import { useTeam, useTeams } from '../api/teams';
import { isFullTeam } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
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

  if (teams.isPending || (teamId && team.isPending)) return <Spinner />;
  if (teams.error) return <ErrorAlert error={teams.error} />;
  if (!teamId) return <Notice>{t('team.notFound')}</Notice>;
  if (team.error || !team.data) return <ErrorAlert error={team.error} />;

  const data = team.data.data;
  const full = isFullTeam(data) ? data : undefined;
  const canAdmin = !!full && canAdminTeam(me, teamId);
  const member = !!full && (isTeamMember(me, teamId) || !!me?.isSystemAdmin);
  const active: TabKey = pathname.includes('/settings') ? 'settings' : pathname.endsWith('/members') ? 'members' : 'overview';
  const go = (tab: string) => {
    void navigate(paths.team(slug, tab === 'members' || tab === 'settings' ? tab : ''));
  };

  return (
    <TeamContext.Provider value={{ teamId, slug, team: data, full, canAdmin, isMember: member }}>
      <Stack gap="4">
        <HStack wrap="wrap">
          <Heading as="h2" size="xl">{data.name}</Heading>
          {data.archived && <Badge colorPalette="gray">{t('team.archived')}</Badge>}
        </HStack>
        <Tabs.Root value={active} onValueChange={(e) => go(e.value)}>
          <Tabs.List>
            <Tabs.Trigger value="overview">{t('tabs.overview')}</Tabs.Trigger>
            {member && <Tabs.Trigger value="members">{t('tabs.members')}</Tabs.Trigger>}
            {canAdmin && <Tabs.Trigger value="settings">{t('tabs.settings')}</Tabs.Trigger>}
          </Tabs.List>
        </Tabs.Root>
        <Outlet />
      </Stack>
    </TeamContext.Provider>
  );
}
