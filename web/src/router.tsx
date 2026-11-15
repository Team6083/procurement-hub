import { Spinner, Stack } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { Outlet, createBrowserRouter, useRouteError, type RouteObject } from 'react-router';
import { ErrorAlert } from './components/ErrorAlert';
import { AppCommitProvider } from '@team6083/ui';
import { useVersionMismatch } from './api/versionGuard';
import { AppFrame } from './components/AppFrame';
import { LocaleSync } from './components/LocaleSync';
import { BASE_PATH } from './config';
import { BatchPage } from './pages/BatchPage';
import { BatchesPage } from './pages/BatchesPage';
import { HomePage } from './pages/HomePage';
import { Placeholder } from './pages/Placeholder';
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

function Layout() {
  return (
    <AppCommitProvider buildCommit={__APP_COMMIT__} outdated={useVersionMismatch()}>
      <LocaleSync />
      <AppFrame>
        <Outlet />
      </AppFrame>
    </AppCommitProvider>
  );
}

/** Errors thrown while rendering a page stay inside the layout instead of replacing the app. */
function RouteError() {
  return <ErrorAlert error={useRouteError()} />;
}

function Callback() {
  const { t } = useTranslation('auth');
  return (
    <Stack align="center">
      <Spinner />
      {t('signingIn')}
    </Stack>
  );
}

/** The route tree (spec section 17.1). Paths are relative to the basename. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/batches', element: <BatchesPage /> },
          { path: '/batches/:id', element: <BatchPage /> },
          { path: '/settings', element: <SettingsPage /> },
          {
            path: '/teams/:slug',
            element: <TeamShell />,
            children: [
              { index: true, element: <TeamOverview /> },
              { path: 'members', element: <TeamMembersTab /> },
              {
                path: 'settings',
                element: <TeamSettingsShell />,
                children: [
                  { index: true, element: <GeneralSettings /> },
                  { path: 'subgroups', element: <SubgroupsSettings /> },
                  { path: 'reference-rates', element: <ReferenceRatesSettings /> },
                  { path: 'members', element: <MembersSettings /> },
                ],
              },
            ],
          },
          { path: '/reports', element: <Placeholder titleKey="pages.reports" /> },
          { path: '/admin/role-mappings', element: <RoleMappingsPage /> },
          { path: '/auth/callback', element: <Callback /> },
          { path: '*', element: <Placeholder titleKey="pages.notFound" /> },
        ],
      },
    ],
  },
];

/** react-router's basename for a Vite base path: "/" → "/", "/sub/" → "/sub". */
export function toBasename(base: string): string {
  return base.replace(/\/+$/, '') || '/';
}

export function createAppRouter(base = BASE_PATH) {
  return createBrowserRouter(routes, { basename: toBasename(base) });
}
