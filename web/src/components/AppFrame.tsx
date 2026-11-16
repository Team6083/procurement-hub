import { AccountMenu, AppShell, BuildInfo, LanguageMenu, SignOutMenuItem, type NavItem } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuFileChartColumn, LuListTodo, LuPackage, LuPackageCheck, LuCoins, LuSettings, LuShoppingCart, LuShieldCheck, LuStore, LuTruck } from 'react-icons/lu';
import { Link, useLocation } from 'react-router';
import { useSession } from '../auth/AuthGate';
import { useMe } from '../api/me';
import { paths } from '../paths';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

const renderLink = (href: string, children: ReactNode) => <Link to={href}>{children}</Link>;

/** Whether `href` is the page at `pathname` or one of its subpages. */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Data pages whose tables need more than the 5xl column (the team's DESIGN.md: Data pages). */
export function isWidePage(pathname: string): boolean {
  return /^\/(batches\/[^/]+|purchasing|vendor-orders(\/[^/]+)?|receiving|deliveries)\/?$/.test(pathname);
}

/** The team app frame (AppShell) with this app's pages and account menu. */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { me, isSystemAdmin } = useMe();
  // Purchasing and receiving are global roles (spec 8.1); a purchaser can also receive.
  const canPurchase = !!me?.isPurchaser;
  const canReceive = !!me?.isReceiver || canPurchase;
  const { change } = useChangeLanguage();
  const { pathname } = useLocation();
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');

  const nav: NavItem[] = [
    { href: '/', label: t('nav.home'), icon: <LuListTodo /> },
    { href: '/batches', label: t('nav.batches'), icon: <LuPackage /> },
    ...(canPurchase ? [{ href: paths.purchasing, label: t('nav.purchasing'), icon: <LuShoppingCart /> }] : []),
    // Receiving is for purchasers and receivers; system admins may look but not change anything (spec 8.2).
    ...(canReceive || isSystemAdmin ? [{ href: paths.receiving, label: t('nav.receiving'), icon: <LuPackageCheck /> }] : []),
    ...(canReceive || isSystemAdmin ? [{ href: paths.deliveries, label: t('nav.deliveries'), icon: <LuTruck /> }] : []),
    { href: '/reports', label: t('nav.reports'), icon: <LuFileChartColumn /> },
    ...(isSystemAdmin || canPurchase ? [{ href: '/admin/vendors', label: t('nav.vendors'), icon: <LuStore /> }] : []),
    ...(isSystemAdmin ? [{ href: '/admin/reference-rates', label: t('nav.rates'), icon: <LuCoins /> }] : []),
    ...(isSystemAdmin ? [{ href: '/admin/role-mappings', label: t('nav.admin'), icon: <LuShieldCheck /> }] : []),
    { href: '/settings', label: t('nav.settings'), icon: <LuSettings /> },
  ].map((item) => ({ ...item, active: isActive(item.href, pathname) }));

  // The language lives in the account menu, folded under one item (the team's DESIGN.md: Frame).
  const languages = SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t(`language.${lang}`) }));

  return (
    <AppShell
      appName={t('app.name')}
      width={isWidePage(pathname) ? 'wide' : 'column'}
      nav={nav}
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
