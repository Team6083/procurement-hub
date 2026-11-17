import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccess } from '../auth/useAccess';
import { SectionLayout, type SectionTab } from '../components/SectionLayout';
import { paths } from '../paths';

/**
 * The Purchasing section: the queue, vendor orders and the vendor list as tabs (spec 17.1). Team members reach only
 * the vendor orders holding their lines, so for them the section is that one page.
 */
export function PurchasingLayout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation('purchasing');
  const { isPurchaser } = useAccess();
  const orders: SectionTab = { to: paths.vendorOrders, label: t('list.title'), description: t(isPurchaser ? 'list.introAll' : 'list.intro') };
  const tabs: SectionTab[] = isPurchaser
    ? [
        { to: paths.purchasing, label: t('queue.tab'), description: t('queue.intro') },
        orders,
        { to: paths.purchasingVendors, label: t('common:nav.vendors'), description: t('admin:vendors.intro') },
      ]
    : [orders];
  return <SectionLayout title={t('common:nav.purchasing')} tabs={tabs}>{children}</SectionLayout>;
}
