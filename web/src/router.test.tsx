import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider, createMemoryRouter, useLocation, useParams } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RouteAnchor } from './components/RouteLinks';
import { Provider } from './components/ui/provider';
import i18n from './i18n';
import { paths } from './paths';
import { createAppRouter, routes, toBasename } from './router';

// Pages and chrome need auth and API context; stand-ins show which route matched and with which params.
function stub(name: string) {
  return function Stub() {
    const params = useParams();
    const { pathname } = useLocation();
    return <p data-testid="page">{`${name} ${JSON.stringify(params)} ${pathname}`}</p>;
  };
}
vi.mock('./components/AppFrame', () => ({ AppFrame: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/LocaleSync', () => ({ LocaleSync: () => null }));
vi.mock('./pages/HomePage', async () => {
  const { RouteAnchor: Anchor } = await import('./components/RouteLinks');
  return { HomePage: () => <Anchor to={paths.batch('b 1')}>open batch</Anchor> };
});
vi.mock('./pages/BatchesPage', () => ({ BatchesPage: stub('batches') }));
vi.mock('./pages/BatchPage', () => ({ BatchPage: stub('batch') }));
vi.mock('./pages/AdminLayout', async () => {
  const { Outlet } = await import('react-router');
  return { AdminLayout: () => <Outlet /> };
});
vi.mock('./pages/RoleMappingsPage', () => ({ RoleMappingsPage: stub('role-mappings') }));
vi.mock('./pages/TeamShell', async () => {
  const { Outlet } = await import('react-router');
  return { TeamShell: () => <section aria-label="team shell"><Outlet /></section> };
});
vi.mock('./pages/TeamOverview', () => ({ TeamOverview: stub('team-overview') }));
vi.mock('./pages/TeamMembersPage', () => ({ TeamMembersPage: stub('team-members') }));
vi.mock('./pages/PurchasingLayout', () => ({ PurchasingLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock('./pages/settings/GeneralSettings', () => ({ GeneralSettings: stub('settings-general') }));
vi.mock('./pages/settings/SubgroupsSettings', () => ({ SubgroupsSettings: stub('settings-subgroups') }));
vi.mock('./pages/VendorsPage', () => ({ VendorsPage: stub('vendors') }));
vi.mock('./pages/PurchasingPage', () => ({ PurchasingPage: stub('purchasing') }));
vi.mock('./pages/VendorOrdersPage', () => ({ VendorOrdersPage: stub('vendor-orders') }));
vi.mock('./pages/VendorOrderPage', () => ({ VendorOrderPage: stub('vendor-order') }));
vi.mock('./pages/ReferenceRatesPage', () => ({ ReferenceRatesPage: stub('reference-rates') }));

beforeAll(() => {
  void i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function renderAt(entry: string, basename = '/') {
  const router = createMemoryRouter(routes, { basename, initialEntries: [entry] });
  render(
    <I18nextProvider i18n={i18n}>
      <Provider>
        <RouterProvider router={router} />
      </Provider>
    </I18nextProvider>,
  );
  return router;
}

const page = () => screen.getByTestId('page').textContent;

describe('routes (spec section 17.1)', () => {
  it.each([
    ['/batches', 'batches {} /batches'],
    ['/batches/42', 'batch {"id":"42"} /batches/42'],
    ['/admin/role-mappings', 'role-mappings {} /admin/role-mappings'],
    ['/admin/vendors', 'vendors {} /admin/vendors'],
    ['/admin/reference-rates', 'reference-rates {} /admin/reference-rates'],
    ['/teams/robotics', 'team-overview {"slug":"robotics"} /teams/robotics'],
    ['/teams/robotics/members', 'team-members {"slug":"robotics"} /teams/robotics/members'],
    ['/teams/robotics/settings', 'settings-general {"slug":"robotics"} /teams/robotics/settings'],
    ['/teams/robotics/settings/subgroups', 'settings-subgroups {"slug":"robotics"} /teams/robotics/settings/subgroups'],
    ['/teams/robotics/settings/members', 'team-members {"slug":"robotics"} /teams/robotics/settings/members'],
  ])('%s', (url, expected) => {
    renderAt(url);
    expect(page()).toBe(expected);
  });

  it('keeps the query string for pages that read it', () => {
    const router = renderAt('/batches/7?tab=review');
    expect(router.state.location.search).toBe('?tab=review');
  });

  it('shows the reports placeholder and a not-found page inside the layout', () => {
    renderAt('/reports');
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeTruthy();
    cleanup();
    renderAt('/teams/x/batches/y');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});

describe('basename', () => {
  it('maps toBasename from the Vite base path', () => {
    expect(toBasename('/')).toBe('/');
    expect(toBasename('/sub/')).toBe('/sub');
    expect(toBasename('/a/b//')).toBe('/a/b');
  });

  it('matches routes under the base path and serves the OIDC callback route', () => {
    renderAt('/sub/teams/robotics/members', '/sub');
    expect(page()).toBe('team-members {"slug":"robotics"} /teams/robotics/members');
    cleanup();
    renderAt('/sub/auth/callback', '/sub');
    expect(screen.getByText('Signing you in…')).toBeTruthy();
  });

  it('prefixes link hrefs with the base path, encodes segments and navigates client-side', async () => {
    const router = renderAt('/sub/', '/sub');
    const link = screen.getByRole('link', { name: 'open batch' });
    expect(link.getAttribute('href')).toBe('/sub/batches/b%201');
    await act(async () => {
      fireEvent.click(link);
    });
    expect(router.state.location.pathname).toBe('/sub/batches/b%201');
    expect(page()).toBe('batch {"id":"b 1"} /batches/b%201');
  });

  it('createAppRouter matches the browser URL under the base path', () => {
    window.history.replaceState(null, '', '/sub/batches/9?tab=items');
    const router = createAppRouter('/sub/');
    expect(router.basename).toBe('/sub');
    expect(router.state.location.pathname).toBe('/sub/batches/9');
    expect(router.state.location.search).toBe('?tab=items');
    expect(router.state.matches.at(-1)?.params).toEqual({ id: '9' });
    router.dispose();
  });
});

describe('RouteAnchor', () => {
  it('leaves modified clicks to the browser', () => {
    const router = createMemoryRouter([{ path: '*', element: <RouteAnchor to="/x">x</RouteAnchor> }], { initialEntries: ['/'] });
    render(
      <Provider>
        <RouterProvider router={router} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'x' }), { ctrlKey: true });
    expect(router.state.location.pathname).toBe('/');
  });
});
