import { Stack, Tabs } from '@chakra-ui/react';
import { PageHeader } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuPlus } from 'react-icons/lu';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { RouteButton } from '../components/RouteLinks';
import { ReceivingGuard, useReceivingAccess } from '../features/receiving/access';
import { paths } from '../paths';

type TabKey = 'workbench' | 'deliveries';

function ReceivingSection() {
  const { t } = useTranslation('receiving');
  const { canWrite } = useReceivingAccess();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active: TabKey = pathname.startsWith(paths.deliveries) ? 'deliveries' : 'workbench';
  return (
    <Stack gap="4">
      <PageHeader
        mb="0" title={t('receiving.title')} description={active === 'deliveries' ? t('list.intro') : t('receiving.intro')}
        actions={canWrite && <RouteButton size="sm" to={paths.newDelivery}><LuPlus />{t('box.title')}</RouteButton>}
      />
      <Tabs.Root value={active} onValueChange={(e) => void navigate(e.value === 'deliveries' ? paths.deliveries : paths.receiving)}>
        <Tabs.List>
          <Tabs.Trigger value="workbench">{t('tabs.workbench')}</Tabs.Trigger>
          <Tabs.Trigger value="deliveries">{t('tabs.deliveries')}</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
      <Outlet />
    </Stack>
  );
}

/** /receiving and /deliveries: one Receiving page with the workbench and the deliveries list as URL-routed tabs. */
export function ReceivingLayout() {
  return (
    <ReceivingGuard>
      <ReceivingSection />
    </ReceivingGuard>
  );
}
