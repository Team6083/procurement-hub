import type { Me, RoleOrNone } from '../../api/types';

type MaybeRole = RoleOrNone | null | undefined;

const RANK: Record<string, number> = { '': 0, member: 1, admin: 2 };
const rank = (r: MaybeRole) => RANK[r ?? ''] ?? 0;

export interface RoleSources {
  ssoRole: MaybeRole;
  manualRole: MaybeRole;
}

/** The lock badge ("Managed by SSO") shows whenever an SSO role source exists. */
export function showSsoLock(m: RoleSources): boolean {
  return rank(m.ssoRole) > 0;
}

/** Team admins can clear the manual role only if another source keeps the membership alive. */
export function canClearManualRole(m: RoleSources): boolean {
  return rank(m.manualRole) > 0 && rank(m.ssoRole) > 0;
}

/** Removing a member clears the manual role, so it needs one (SSO-only members cannot be removed). */
export function canRemoveMember(m: RoleSources): boolean {
  return rank(m.manualRole) > 0;
}

/** True when the user may administer the team (system admin or effective team admin). */
export function canAdminTeam(me: Pick<Me, 'isSystemAdmin' | 'memberships'> | undefined, teamId: string | undefined): boolean {
  if (!me || !teamId) return false;
  if (me.isSystemAdmin) return true;
  return me.memberships.some((m) => m.teamId === teamId && m.role === 'admin');
}

export function isTeamMember(me: Pick<Me, 'memberships'> | undefined, teamId: string | undefined): boolean {
  return !!me && !!teamId && me.memberships.some((m) => m.teamId === teamId);
}
