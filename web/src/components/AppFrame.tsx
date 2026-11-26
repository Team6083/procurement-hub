import { AccountMenu, AppShell, BuildInfo, LanguageMenu, SignOutMenuItem, commitsDiffer, type NavLink } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackage, LuPackageCheck, LuShieldCheck, LuShoppingCart } from 'react-icons/lu';
import { Link, useLocation } from 'react-router';
import { useMeta } from '../api/meta';
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

/** The team app frame (AppShell) with this app's pages and account menu. */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { isPurchaser: canPurchase, canSeeReceiving, isSystemAdmin } = useAccess();
  const { change } = useChangeLanguage();
  const { pathname } = useLocation();
  const { data: meta } = useMeta();
  // The footer shows the API's release version only while the SPA is the same build as the API (spec 6.3); the
  // front end never derives a version itself. An unknown commit on either side is not "the same".
  const appCommit = __APP_COMMIT__ === 'unknown' ? null : __APP_COMMIT__;
  const sameCommit = appCommit !== null && !!meta?.build.commit && !commitsDiffer(appCommit, meta.build.commit);
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');

  // At most five pages per role (the team's DESIGN.md: Frame); vendor orders and vendors open from the Purchasing
  // page, deliveries are a tab of Receiving, and the admin pages share one entry.
  const nav: (NavLink & { match?: string[] })[] = [
    { href: '/batches', label: t('nav.batches'), icon: <LuPackage /> },
    ...(canPurchase
      ? [{
          href: paths.purchasing, label: t('nav.purchasing'), icon: <LuShoppingCart />,
          match: ['/vendor-orders'],
        }]
      : []),
    // Receiving is for purchasers and receivers; system admins may look but not change anything (spec 8.2).
    ...(canSeeReceiving ? [{ href: paths.receiving, label: t('nav.receiving'), icon: <LuPackageCheck />, match: [paths.deliveries] }] : []),
    ...(isSystemAdmin ? [{ href: paths.admin, label: t('nav.admin'), icon: <LuShieldCheck /> }] : []),
  ];
  const items: NavLink[] = nav.map(({ match = [], ...item }) => ({
    ...item,
    active: [item.href, ...match].some((href) => isActive(href, pathname)),
  }));

  // The language lives in the account menu, folded under one item (the team's DESIGN.md: Frame).
  const languages = SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t(`language.${lang}`) }));

  return (
    <AppShell
      appName={t('app.name')}
      // One width for the whole app, so the header and content never move while navigating; tables need the wide one.
      // width="wide"
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
      buildInfo={
        <BuildInfo
          name="App"
          commit={appCommit}
          builtAt={__APP_BUILT_AT__}
          version={sameCommit ? meta?.build.version : undefined}
          components={meta ? [{ name: 'API', ...meta.build }] : []}
        />
      }
    >
      {children}
    </AppShell>
  );
}
