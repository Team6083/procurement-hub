import { AccountMenu, AppShell, BuildInfo, LanguageMenu, SignOutMenuItem, type NavItem } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuListTodo, LuPackage, LuPackageCheck, LuShieldCheck, LuShoppingCart } from 'react-icons/lu';
import { Link, useLocation } from 'react-router';
import { useSession } from '../auth/AuthGate';
import { useAccess } from '../auth/useAccess';
import { paths } from '../paths';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

const renderLink = (href: string, children: ReactNode) => <Link to={href}>{children}</Link>;

/** Whether `href` is the page at `pathname` or one of its subpages. */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The width is decided per section, never per page, so moving around inside a section never changes it. Batches
 * (list and detail) and Purchasing (queue, vendor orders, and the vendor list when it is Purchasing's tab) hold the
 * wide tables (the team's DESIGN.md: Data pages); home, teams, receiving and admin stay in the column.
 */
function isWideSection(pathname: string, vendorsInPurchasing: boolean): boolean {
  if (/^\/(batches|purchasing|vendor-orders)(\/|$)/.test(pathname)) return true;
  return vendorsInPurchasing && isActive(paths.adminVendors, pathname);
}

/** The team app frame (AppShell) with this app's pages and account menu. */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { isPurchaser: canPurchase, canSeeReceiving, isSystemAdmin } = useAccess();
  const { change } = useChangeLanguage();
  const { pathname } = useLocation();
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');

  // At most five pages per role (the team's DESIGN.md: Frame); vendor orders and vendors open from the Purchasing
  // page, deliveries are a tab of Receiving, and the admin pages share one entry.
  const nav: (NavItem & { match?: string[] })[] = [
    { href: '/', label: t('nav.home'), icon: <LuListTodo /> },
    { href: '/batches', label: t('nav.batches'), icon: <LuPackage /> },
    ...(canPurchase
      ? [{
          href: paths.purchasing, label: t('nav.purchasing'), icon: <LuShoppingCart />,
          match: ['/vendor-orders', ...(isSystemAdmin ? [] : [paths.adminVendors])],
        }]
      : []),
    // Receiving is for purchasers and receivers; system admins may look but not change anything (spec 8.2).
    ...(canSeeReceiving ? [{ href: paths.receiving, label: t('nav.receiving'), icon: <LuPackageCheck />, match: [paths.deliveries] }] : []),
    ...(isSystemAdmin ? [{ href: paths.admin, label: t('nav.admin'), icon: <LuShieldCheck /> }] : []),
  ];
  const items: NavItem[] = nav.map(({ match = [], ...item }) => ({
    ...item,
    active: [item.href, ...match].some((href) => isActive(href, pathname)),
  }));

  // The language lives in the account menu, folded under one item (the team's DESIGN.md: Frame).
  const languages = SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t(`language.${lang}`) }));

  return (
    <AppShell
      appName={t('app.name')}
      width={isWideSection(pathname, canPurchase && !isSystemAdmin) ? 'wide' : 'column'}
      nav={items}
      renderLink={renderLink}
      account={
        <AccountMenu name={name} detail={user.profile.email}>
          <LanguageMenu
            languages={languages}
            value={i18n.resolvedLanguage ?? 'en'}
            onChange={(lang) => change(lang as Language)}
          />
          <SignOutMenuItem onSelect={() => void logout()} />
        </AccountMenu>
      }
      buildInfo={<BuildInfo commit={__APP_COMMIT__ === 'unknown' ? null : __APP_COMMIT__} />}
    >
      {children}
    </AppShell>
  );
}
