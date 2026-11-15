import { HStack, Stack } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { Notice } from '../components/ErrorAlert';
import { RouteButton } from '../components/RouteLinks';
import { useTeamCtx } from '../features/teams/TeamContext';
import { paths } from '../paths';

export function TeamSettingsShell() {
  const { t } = useTranslation('teams');
  const { slug, canAdmin, team } = useTeamCtx();
  const { pathname } = useLocation();
  if (!canAdmin) return <Notice>{t('settings.forbidden')}</Notice>;
  const isActive = (suffix: string) => (suffix === '' ? pathname.replace(/\/$/, '').endsWith('/settings') : pathname.endsWith(suffix));
  const nav = (suffix: string, label: string) => (
    <RouteButton
      to={paths.team(slug, `settings${suffix}`)}
      variant={isActive(suffix) ? 'subtle' : 'ghost'}
      size="sm"
      aria-current={isActive(suffix) ? 'page' : undefined}
    >
      {label}
    </RouteButton>
  );
  return (
    <Stack gap="4">
      {team.archived && <Notice status="warning">{t('settings.archivedNotice')}</Notice>}
      <HStack gap="1" wrap="wrap" as="nav">
        {nav('', t('settings.nav.general'))}
        {nav('/subgroups', t('settings.nav.subgroups'))}
        {nav('/reference-rates', t('settings.nav.rates'))}
        {nav('/members', t('settings.nav.members'))}
      </HStack>
      <Outlet />
    </Stack>
  );
}
