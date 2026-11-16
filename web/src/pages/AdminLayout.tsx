import { Stack, Tabs } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { LuCoins, LuShieldCheck, LuStore } from 'react-icons/lu';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../api/me';
import { paths } from '../paths';

const PAGES = [
  { href: paths.adminVendors, label: 'nav.vendors', icon: <LuStore /> },
  { href: paths.referenceRates, label: 'nav.rates', icon: <LuCoins /> },
  { href: paths.roleMappings, label: 'nav.roleMappings', icon: <LuShieldCheck /> },
];

/**
 * The admin section (/admin/*): one navigation entry for system admins, with its pages as subtle tabs. Purchasers
 * reach the vendor list from the Purchasing page and see it without the admin tabs.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const { isSystemAdmin } = useMe();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!isSystemAdmin) return <Outlet />;
  const active = PAGES.find((p) => pathname.startsWith(p.href))?.href ?? '';
  return (
    <Stack gap="4">
      <Tabs.Root value={active} onValueChange={(e) => void navigate(e.value)} variant="subtle" size="sm">
        <Tabs.List aria-label={t('nav.admin')} flexWrap="wrap">
          {PAGES.map((p) => (
            <Tabs.Trigger key={p.href} value={p.href}>
              {p.icon}
              {t(p.label)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <Outlet />
    </Stack>
  );
}
