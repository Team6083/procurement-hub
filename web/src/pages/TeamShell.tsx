import { Badge } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useTeam, useTeams } from '../api/teams';
import { isFullTeam } from '../api/types';
import { useAccess } from '../auth/useAccess';
import { LoadError, NotFound, PageSkeleton } from '../components/PageStates';
import { SectionLayout, type SectionTab } from '../components/SectionLayout';
import { TeamContext } from '../features/teams/TeamContext';
import { paths } from '../paths';

/**
 * /teams/:slug/*: the team's section. Tabs: Overview for everyone who can see the team, Members for members, and
 * Subgroups and Settings for team admins (spec 17.1 keeps their URLs under /settings).
 */
export function TeamShell() {
  const { t } = useTranslation('teams');
  const { slug = '' } = useParams();
  const access = useAccess();
  const teams = useTeams();
  const teamId = teams.data?.find((x) => x.slug === slug)?.id;
  const team = useTeam(teamId);

  if (teams.isPending || (teamId && team.isPending)) return <PageSkeleton />;
  if (teams.error) return <LoadError error={teams.error} />;
  if (!teamId) return <NotFound />;
  if (team.error || !team.data) return <LoadError error={team.error} />;

  const data = team.data;
  const full = isFullTeam(data) ? data : undefined;
  const canAdmin = !!full && access.canAdminTeam(teamId);
  const member = !!full && (access.isTeamMember(teamId) || access.isSystemAdmin);
  const tabs: SectionTab[] = [
    { to: paths.team(slug), label: t('tabs.overview') },
    ...(member ? [{ to: paths.team(slug, 'members'), label: t('tabs.members'), match: [paths.team(slug, 'settings/members')] }] : []),
    ...(canAdmin
      ? [
          { to: paths.team(slug, 'settings/subgroups'), label: t('tabs.subgroups') },
          { to: paths.team(slug, 'settings'), label: t('tabs.settings') },
        ]
      : []),
  ];

  return (
    <TeamContext.Provider value={{ teamId, slug, team: data, full, canAdmin, isMember: member }}>
      <SectionLayout title={data.name} badge={data.archived && <Badge colorPalette="orange" variant="subtle">{t('team.archived')}</Badge>} tabs={tabs} />
    </TeamContext.Provider>
  );
}
