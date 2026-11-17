import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { RoleGuard } from '../components/PageStates';
import { DeliveryView } from '../features/receiving/DeliveryView';

export function DeliveryPage() {
  const { t } = useTranslation('receiving');
  const { id } = useParams();
  return (
    <RoleGuard allow={(a) => a.canSeeReceiving} description={t('access.denied')}>
      <DeliveryView id={id ?? ''} />
    </RoleGuard>
  );
}
