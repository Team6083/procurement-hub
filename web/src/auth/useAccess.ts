import { useMe } from '../api/me';
import { canAdminTeam, isTeamMember } from '../features/teams/roles';

/**
 * Every role check of the app in one place (spec 8.1, 8.2). Purchasing and receiving are global roles; a purchaser
 * can also receive; system admins may look at purchasing and receiving but change nothing there.
 */
export function useAccess() {
  const { me, isPending } = useMe();
  const isSystemAdmin = !!me?.isSystemAdmin;
  const isPurchaser = !!me?.isPurchaser;
  const canReceive = isPurchaser || !!me?.isReceiver;
  return {
    isPending,
    isSystemAdmin,
    isPurchaser,
    /** Registers and matches deliveries (purchasers and receivers). */
    canReceive,
    /** Sees the receiving pages, read-only for system admins. */
    canSeeReceiving: canReceive || isSystemAdmin,
    /** Edits the shared vendor list. */
    canEditVendors: isPurchaser || isSystemAdmin,
    canAdminTeam: (teamId: string | undefined) => canAdminTeam(me, teamId),
    isTeamMember: (teamId: string | undefined) => isTeamMember(me, teamId),
  };
}

export type Access = ReturnType<typeof useAccess>;
