import { Skeleton } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../api/me';
import { Notice } from '../../components/ErrorAlert';

/**
 * Who may use receiving (spec 8.1, 17.1): purchasers and receivers read and write; system admins only read;
 * purchasers alone settle problems and close lines.
 */
export function useReceivingAccess() {
  const { me, isPending } = useMe();
  const canPurchase = !!me?.isPurchaser;
  const canWrite = canPurchase || !!me?.isReceiver;
  const isSystemAdmin = !!me?.isSystemAdmin;
  return { isPending, canPurchase, canWrite, isSystemAdmin, canSee: canWrite || isSystemAdmin };
}

/** Route guard for the receiving pages; `write` also turns system admins away (they are read-only). */
export function ReceivingGuard({ write = false, children }: { write?: boolean; children: ReactNode }) {
  const { t } = useTranslation('receiving');
  const access = useReceivingAccess();
  if (access.isPending) return <Skeleton h="24" rounded="l3" />;
  if (!access.canSee) return <Notice status="warning">{t('access.denied')}</Notice>;
  if (write && !access.canWrite) return <Notice status="info">{t('access.readOnly')}</Notice>;
  return <>{children}</>;
}
