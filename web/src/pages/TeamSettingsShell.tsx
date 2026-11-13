import { Alert, Group, Stack } from '@mantine/core';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RouteButton } from '../components/RouteLinks';
import { useTeamCtx } from '../features/teams/TeamContext';

export function TeamSettingsShell() {
  const { t } = useTranslation('teams');
  const { slug, canAdmin, team } = useTeamCtx();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!canAdmin) return <Alert color="gray">{t('settings.forbidden')}</Alert>;
  const variant = (suffix: string) =>
    (suffix === '' ? pathname.replace(/\/$/, '').endsWith('/settings') : pathname.endsWith(suffix)) ? 'filled' : 'light';
  return (
    <Stack>
      {team.archived && <Alert color="yellow">{t('settings.archivedNotice')}</Alert>}
      <Group gap="xs">
        <RouteButton href={`/teams/${slug}/settings`} variant={variant('')} size="xs">{t('settings.nav.general')}</RouteButton>
        <RouteButton href={`/teams/${slug}/settings/subgroups`} variant={variant('/subgroups')} size="xs">{t('settings.nav.subgroups')}</RouteButton>
        <RouteButton href={`/teams/${slug}/settings/reference-rates`} variant={variant('/reference-rates')} size="xs">{t('settings.nav.rates')}</RouteButton>
        <RouteButton href={`/teams/${slug}/settings/members`} variant={variant('/members')} size="xs">{t('settings.nav.members')}</RouteButton>
      </Group>
      <Outlet />
    </Stack>
  );
}
