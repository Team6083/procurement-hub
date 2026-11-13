import { Container, Loader, Stack } from '@mantine/core';
import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Header } from './components/Header';
import { UpdateBanner } from './components/UpdateBanner';
import { Placeholder } from './pages/Placeholder';
import { useTranslation } from 'react-i18next';
import { BatchPage } from './pages/BatchPage';
import { BatchesPage } from './pages/BatchesPage';
import { HomePage } from './pages/HomePage';
import { RoleMappingsPage } from './pages/RoleMappingsPage';
import { SettingsPage } from './pages/SettingsPage';
import { GeneralSettings } from './pages/settings/GeneralSettings';
import { MembersSettings } from './pages/settings/MembersSettings';
import { ReferenceRatesSettings } from './pages/settings/ReferenceRatesSettings';
import { SubgroupsSettings } from './pages/settings/SubgroupsSettings';
import { TeamMembersTab } from './pages/TeamMembersTab';
import { TeamOverview } from './pages/TeamOverview';
import { TeamSettingsShell } from './pages/TeamSettingsShell';
import { TeamShell } from './pages/TeamShell';
import { LocaleSync } from './components/LocaleSync';
import { BASE_PATH } from './config';

function Layout() {
  return (
    <Stack gap={0}>
      <UpdateBanner />
      <Header />
      <LocaleSync />
      <Container size="xl" w="100%" py="md">
        <Outlet />
      </Container>
    </Stack>
  );
}

function NotFound() {
  return <Placeholder titleKey="pages.notFound" />;
}

function Callback() {
  const { t } = useTranslation('auth');
  return (
    <Stack align="center">
      <Loader />
      {t('signingIn')}
    </Stack>
  );
}

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const page = (path: string, titleKey: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => <Placeholder titleKey={titleKey} /> });

const route = (path: string, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/teams/$slug', component: TeamShell });
const settingsShell = createRoute({ getParentRoute: () => teamRoute, path: 'settings', component: TeamSettingsShell });
const teamTree = teamRoute.addChildren([
  createRoute({ getParentRoute: () => teamRoute, path: '/', component: TeamOverview }),
  createRoute({ getParentRoute: () => teamRoute, path: 'members', component: TeamMembersTab }),
  settingsShell.addChildren([
    createRoute({ getParentRoute: () => settingsShell, path: '/', component: GeneralSettings }),
    createRoute({ getParentRoute: () => settingsShell, path: 'subgroups', component: SubgroupsSettings }),
    createRoute({ getParentRoute: () => settingsShell, path: 'reference-rates', component: ReferenceRatesSettings }),
    createRoute({ getParentRoute: () => settingsShell, path: 'members', component: MembersSettings }),
  ]),
]);

const routeTree = rootRoute.addChildren([
  route('/', HomePage),
  route('/batches', BatchesPage),
  route('/settings', SettingsPage),
  teamTree,
  route('/batches/$id', BatchPage),
  page('/reports', 'pages.reports'),
  route('/admin/role-mappings', RoleMappingsPage),
  createRoute({ getParentRoute: () => rootRoute, path: '/auth/callback', component: Callback }),
]);

export function createAppRouter() {
  return createRouter({ routeTree, basepath: BASE_PATH.replace(/\/+$/, '') || '/' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
