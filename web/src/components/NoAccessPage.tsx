import { Button } from '@chakra-ui/react';
import { NoAccessPage as TeamNoAccessPage } from '@team6083/ui';
import { useTranslation } from 'react-i18next';

/** Shown instead of the whole app once the API answers 403 missing_role (spec section 7.1). */
export function NoAccessPage({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation('auth');
  return <TeamNoAccessPage minH="100vh" actions={<Button onClick={onSignOut}>{t('noAccess.signOut')}</Button>} />;
}
