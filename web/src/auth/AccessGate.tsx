import type { ReactNode } from 'react';
import { NoAccessPage } from '../components/NoAccessPage';
import { useAccessDenied, type AccessStore } from './access';

/** Replaces the whole app with the no-access page once access is denied (spec section 7.1). */
export function AccessGate({ store, onSignOut, children }: { store: AccessStore; onSignOut: () => void; children: ReactNode }) {
  const denied = useAccessDenied(store);
  if (denied) return <NoAccessPage onSignOut={onSignOut} />;
  return <>{children}</>;
}
