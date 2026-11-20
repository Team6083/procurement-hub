import { Button } from '@chakra-ui/react';
import { NoAccessPage } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccessDenied, type AccessStore } from './access';

/** Replaces the whole app with the no-access page once access is denied (spec section 7.1). */
export function AccessGate({ store, onSignOut, children }: { store: AccessStore; onSignOut: () => void; children: ReactNode }) {
  const { t } = useTranslation('auth');
  const denied = useAccessDenied(store);
  if (denied) return <NoAccessPage minH="100vh" actions={<Button onClick={onSignOut}>{t('noAccess.signOut')}</Button>} />;
  return <>{children}</>;
}
