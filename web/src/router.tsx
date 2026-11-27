import { Spinner } from '@chakra-ui/react';
import { StatusPage } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, createBrowserRouter, useRouteError, type RouteObject } from 'react-router';
import { ErrorAlert } from './components/ErrorAlert';
import { AppFrame } from './components/AppFrame';
import { LocaleSync } from './components/LocaleSync';
import { BASE_PATH } from './config';
import { AdminLayout } from './pages/AdminLayout';
import { BatchPage } from './pages/BatchPage';
import { BatchesPage } from './pages/BatchesPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DeliveryNewPage } from './pages/DeliveryNewPage';
import { DeliveryPage } from './pages/DeliveryPage';
import { HomePage } from './pages/HomePage';
import { NotFound, RoleGuard } from './components/PageStates';
import { PurchasingLayout } from './pages/PurchasingLayout';
import { Placeholder } from './pages/Placeholder';
import { PurchasingPage } from './pages/PurchasingPage';
import { ReceivingLayout } from './pages/ReceivingLayout';
import { ReceivingPage } from './pages/ReceivingPage';
import { VendorOrderPage } from './pages/VendorOrderPage';
import { VendorOrdersPage } from './pages/VendorOrdersPage';
import { ReferenceRatesPage } from './pages/ReferenceRatesPage';
import { RoleMappingsPage } from './pages/RoleMappingsPage';
import { GeneralSettings } from './pages/settings/GeneralSettings';
import { SubgroupsSettings } from './pages/settings/SubgroupsSettings';
import { TeamMembersPage } from './pages/TeamMembersPage';
import { TeamOverview } from './pages/TeamOverview';
import { TeamShell } from './pages/TeamShell';
import { VendorsPage } from './pages/VendorsPage';

/** /purchasing is for purchasers only; the queue request is never made for anyone else (it would answer 403). */
function PurchasingGuard() {
  const { t } = useTranslation('purchasing');
  return <RoleGuard allow={(a) => a.isPurchaser} description={t('queue.purchasersOnly')}><PurchasingPage /></RoleGuard>;
}

/** Purchasing's vendor tab: the same vendor list as Admin, kept inside Purchasing so the tab never leaves the section. */
function PurchasingVendorsGuard() {
  const { t } = useTranslation('purchasing');
  return <RoleGuard allow={(a) => a.isPurchaser} description={t('queue.purchasersOnly')}><VendorsPage /></RoleGuard>;
}

function Layout() {
  return (
    <>
      <LocaleSync />
      <AppFrame>
        <Outlet />
      </AppFrame>
    </>
  );
}

/** Errors thrown while rendering a page stay inside the layout instead of replacing the app. */
function RouteError() {
  return <ErrorAlert error={useRouteError()} />;
}

function Callback() {
  const { t } = useTranslation('auth');
  return (
    <StatusPage minH="100vh" icon={<Spinner />} title={t('signingIn')} />
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
          {
            element: <PurchasingLayout><Outlet /></PurchasingLayout>,
            children: [
              { path: '/purchasing', element: <PurchasingGuard /> },
              { path: '/vendor-orders', element: <VendorOrdersPage /> },
              { path: '/purchasing/vendors', element: <PurchasingVendorsGuard /> },
            ],
          },
          { path: '/vendor-orders/:id', element: <VendorOrderPage /> },
          {
            element: <ReceivingLayout />,
            children: [
              { path: '/receiving', element: <ReceivingPage /> },
              { path: '/deliveries', element: <DeliveriesPage /> },
            ],
          },
          { path: '/deliveries/new', element: <DeliveryNewPage /> },
          { path: '/deliveries/:id', element: <DeliveryPage /> },
          {
            path: '/teams/:slug',
            element: <TeamShell />,
            children: [
              { index: true, element: <TeamOverview /> },
              { path: 'members', element: <TeamMembersPage /> },
              { path: 'settings', element: <GeneralSettings /> },
              { path: 'settings/subgroups', element: <SubgroupsSettings /> },
              { path: 'settings/members', element: <TeamMembersPage /> },
            ],
          },
          { path: '/reports', element: <Placeholder titleKey="pages.reports" /> },
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="vendors" replace /> },
              { path: 'vendors', element: <VendorsPage /> },
              { path: 'reference-rates', element: <ReferenceRatesPage /> },
              { path: 'role-mappings', element: <RoleMappingsPage /> },
            ],
          },
          { path: '/auth/callback', element: <Callback /> },
          { path: '*', element: <NotFound /> },
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
