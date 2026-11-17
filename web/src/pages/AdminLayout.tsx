import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { useAccess } from '../auth/useAccess';
import { Forbidden, PageSkeleton } from '../components/PageStates';
import { SectionLayout } from '../components/SectionLayout';
import { useMeta } from '../api/meta';
import { paths } from '../paths';

/**
 * /admin/*: the Admin section for system admins (vendors, reference rates, role mappings as tabs). Purchasers have
 * the vendor list at /purchasing/vendors, a tab of Purchasing; everyone may read the reference rates (spec 17.1); the rest is forbidden.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const access = useAccess();
  const { pathname } = useLocation();
  const base = useMeta().data?.baseCurrency ?? '';
  if (access.isPending) return <PageSkeleton />;
  const rates = { to: paths.referenceRates, label: t('nav.rates'), description: t('admin:rates.intro', { base }) };
  if (access.isSystemAdmin) {
    return (
      <SectionLayout
        title={t('nav.admin')}
        tabs={[
          { to: paths.adminVendors, label: t('nav.vendors'), description: t('admin:vendors.intro') },
          rates,
          { to: paths.roleMappings, label: t('nav.roleMappings'), description: t('admin:intro') },
        ]}
      />
    );
  }
  // Old links to the vendor list from purchasers land on Purchasing's own tab.
  if (access.isPurchaser && pathname.startsWith(paths.adminVendors)) return <Navigate to={paths.purchasingVendors} replace />;
  if (pathname.startsWith(paths.referenceRates)) return <SectionLayout title={t('nav.rates')} tabs={[rates]} />;
  return <Forbidden />;
}
