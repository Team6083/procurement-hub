import { Button } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { StatusPage } from './StatusPage';

/** Shown instead of the whole app once the API answers 403 missing_role (spec section 7.1). */
export function NoAccessPage({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation('auth');
  return (
    <StatusPage title={t('noAccess.title')} body={t('noAccess.body')}>
      <Button onClick={onSignOut}>{t('noAccess.signOut')}</Button>
    </StatusPage>
  );
}
