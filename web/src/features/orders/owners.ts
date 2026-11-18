import { useRoleHolders } from '../../api/members';
import { useTranslation } from 'react-i18next';

/** Resolves an owner's user id to a display name (owners are purchasers); unknown ids, e.g. a former purchaser, get a placeholder. */
export function useOwnerName() {
  const { t } = useTranslation('common');
  const holders = useRoleHolders('purchaser').data ?? [];
  return (id: string) => {
    const u = holders.find((x) => x.id === id);
    return u ? u.displayName || u.username : t('unknownUser');
  };
}
