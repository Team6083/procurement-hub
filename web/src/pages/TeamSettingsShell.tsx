import { Alert, Group, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { RouteButton } from '../components/RouteLinks';
import { useTeamCtx } from '../features/teams/TeamContext';
import { paths } from '../paths';

export function TeamSettingsShell() {
  const { t } = useTranslation('teams');
  const { slug, canAdmin, team } = useTeamCtx();
  const { pathname } = useLocation();
  if (!canAdmin) return <Alert color="gray">{t('settings.forbidden')}</Alert>;
  const variant = (suffix: string) =>
    (suffix === '' ? pathname.replace(/\/$/, '').endsWith('/settings') : pathname.endsWith(suffix)) ? 'filled' : 'light';
  return (
    <Stack>
      {team.archived && <Alert color="yellow">{t('settings.archivedNotice')}</Alert>}
      <Group gap="xs">
        <RouteButton to={paths.team(slug, 'settings')} variant={variant('')} size="xs">{t('settings.nav.general')}</RouteButton>
        <RouteButton to={paths.team(slug, 'settings/subgroups')} variant={variant('/subgroups')} size="xs">{t('settings.nav.subgroups')}</RouteButton>
        <RouteButton to={paths.team(slug, 'settings/reference-rates')} variant={variant('/reference-rates')} size="xs">{t('settings.nav.rates')}</RouteButton>
        <RouteButton to={paths.team(slug, 'settings/members')} variant={variant('/members')} size="xs">{t('settings.nav.members')}</RouteButton>
      </Group>
      <Outlet />
    </Stack>
  );
}
