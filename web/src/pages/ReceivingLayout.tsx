import { useTranslation } from 'react-i18next';
import { LuPlus } from 'react-icons/lu';
import { Outlet } from 'react-router';
import { useAccess } from '../auth/useAccess';
import { RoleGuard } from '../components/PageStates';
import { RouteButton } from '../components/RouteLinks';
import { SectionActions, SectionLayout } from '../components/SectionLayout';
import { paths } from '../paths';

function ReceivingSection() {
  const { t } = useTranslation('receiving');
  const { canReceive } = useAccess();
  return (
    <SectionLayout
      title={t('receiving.title')}
      tabs={[
        { to: paths.receiving, label: t('tabs.workbench'), description: t('receiving.intro') },
        { to: paths.deliveries, label: t('tabs.deliveries'), description: t('list.intro') },
      ]}
    >
      {canReceive && <SectionActions><RouteButton size="sm" to={paths.newDelivery}><LuPlus />{t('box.title')}</RouteButton></SectionActions>}
      <Outlet />
    </SectionLayout>
  );
}

/** /receiving and /deliveries: one Receiving section with the workbench and the deliveries list as URL-routed tabs. */
export function ReceivingLayout() {
  const { t } = useTranslation('receiving');
  return (
    <RoleGuard allow={(a) => a.canSeeReceiving} description={t('access.denied')}>
      <ReceivingSection />
    </RoleGuard>
  );
}
