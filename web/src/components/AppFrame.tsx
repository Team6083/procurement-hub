import { AccountMenu, AppShell, BuildInfo, LanguageMenu, SignOutMenuItem, type NavItem } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuFileChartColumn, LuListTodo, LuPackage, LuSettings, LuShoppingCart, LuShieldCheck } from 'react-icons/lu';
import { Link, useLocation } from 'react-router';
import { useSession } from '../auth/AuthGate';
import { useMyTasks } from '../api/batches';
import { useMe } from '../api/me';
import { paths } from '../paths';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

const renderLink = (href: string, children: ReactNode) => <Link to={href}>{children}</Link>;

/** Whether `href` is the page at `pathname` or one of its subpages. */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** The team app frame (AppShell) with this app's pages and account menu. */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { isSystemAdmin, memberships } = useMe();
  const tasks = useMyTasks();
  // Purchasers are assigned per batch, so the page shows for team admins, system admins and anyone with a batch to order.
  const canOrder = isSystemAdmin || memberships.some((m) => m.role === 'admin') || (tasks.data?.batchesToOrder ?? []).length > 0;
  const { change } = useChangeLanguage();
  const { pathname } = useLocation();
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');

  const nav: NavItem[] = [
    { href: '/', label: t('nav.home'), icon: <LuListTodo /> },
    { href: '/batches', label: t('nav.batches'), icon: <LuPackage /> },
    ...(canOrder ? [{ href: paths.placeOrders, label: t('nav.placeOrders'), icon: <LuShoppingCart /> }] : []),
    { href: '/reports', label: t('nav.reports'), icon: <LuFileChartColumn /> },
    ...(isSystemAdmin ? [{ href: '/admin/role-mappings', label: t('nav.admin'), icon: <LuShieldCheck /> }] : []),
    { href: '/settings', label: t('nav.settings'), icon: <LuSettings /> },
  ].map((item) => ({ ...item, active: isActive(item.href, pathname) }));

  // The language lives in the account menu, folded under one item (the team's DESIGN.md: Frame).
  const languages = SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t(`language.${lang}`) }));

  return (
    <AppShell
      appName={t('app.name')}
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
