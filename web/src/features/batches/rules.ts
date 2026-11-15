import type { Batch, BatchAction, Item, Me, RoleOrNone } from '../../api/types';

/** The caller's standing relative to one batch's team. */
export interface Caller {
  userId: string;
  isSystemAdmin: boolean;
  /** Effective team role, undefined when not a member. */
  teamRole: RoleOrNone | undefined;
  archived: boolean;
}

export function callerFor(me: Pick<Me, 'id' | 'isSystemAdmin' | 'memberships'> | undefined, teamId: string, archived = false): Caller {
  const role = me?.memberships.find((m) => m.teamId === teamId)?.role;
  return { userId: me?.id ?? '', isSystemAdmin: !!me?.isSystemAdmin, teamRole: role || undefined, archived };
}

export const isTeamAdmin = (c: Caller) => c.teamRole === 'admin';
/** Mirrors the backend's CanAdminTeam: team admin or system admin. */
export const canAdmin = (c: Caller) => isTeamAdmin(c) || c.isSystemAdmin;
export const isMember = (c: Caller) => !!c.teamRole;

export const isClosed = (b: Pick<Batch, 'status'>) => ['completed', 'cancelled', 'proposal_rejected'].includes(b.status);

export function assignmentsComplete(b: Pick<Batch, 'assignments'>): boolean {
  const a = b.assignments;
  return a.approvers.length > 0 && a.purchasers.length > 0 && a.receivers.length > 0;
}

export interface ActionAvailability {
  action: BatchAction;
  /** Present when the action is shown but its guard currently fails. */
  disabled?: 'assignments' | 'noPending';
}

/**
 * Manual batch actions to offer. Permission and source-state mismatches are hidden;
 * guards the user can fix (assignments, pending items) show as disabled.
 * `pendingItems` undefined means unknown (items not loaded).
 */
export function availableActions(b: Batch, c: Caller, pendingItems?: number): ActionAvailability[] {
  if (c.archived) return [];
  const out: ActionAvailability[] = [];
  const s = b.status;
  if (canAdmin(c)) {
    if (s === 'proposed' || s === 'draft') {
      out.push({ action: 'open', ...(assignmentsComplete(b) ? {} : { disabled: 'assignments' as const }) });
      const noPending = pendingItems === 0;
      if (!assignmentsComplete(b)) out.push({ action: 'start_review', disabled: 'assignments' });
      else if (noPending) out.push({ action: 'start_review', disabled: 'noPending' });
      else out.push({ action: 'start_review' });
    }
    if (s === 'collecting') out.push({ action: 'close' });
    if (s === 'reviewing') out.push({ action: 'reopen' });
    if (s === 'draft' || s === 'collecting' || s === 'reviewing') out.push({ action: 'cancel' });
    if (s === 'proposed') out.push({ action: 'reject_proposal' });
  }
  if (s === 'proposed' && b.origin === 'proposed' && b.createdBy === c.userId) out.push({ action: 'withdraw_proposal' });
  return out;
}

/** Edit title/description/deadline/visibility and assignments. */
export function canEditBatch(b: Batch, c: Caller): boolean {
  return canAdmin(c) && !c.archived && !isClosed(b);
}

export function canAddItem(b: Batch, c: Caller): boolean {
  if (!isMember(c) || c.archived) return false;
  if (b.status === 'proposed') return b.createdBy === c.userId;
  return b.status === 'collecting';
}

/** Mirrors backend canModify: requester rules, plus the admin override (team or system admin) while collecting. */
export function canModifyItem(it: Pick<Item, 'requesterId' | 'status'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  if (c.archived) return false;
  if (it.requesterId === c.userId) {
    if (it.status === 'pending' && (b.status === 'proposed' || b.status === 'collecting')) return true;
    if (it.status === 'returned' && b.status === 'reviewing') return true;
  }
  // Team admins and system admins (backend CanAdminTeam); system admins still have no implicit membership.
  return canAdmin(c) && b.status === 'collecting' && (it.status === 'pending' || it.status === 'returned');
}

/** Resubmit only after an edit since the return: item.version above review.atVersion (backend item_not_edited). */
export function isEditedSinceReturn(it: Pick<Item, 'version' | 'review'>): boolean {
  if (!it.review) return true;
  return it.version > it.review.atVersion;
}

export function canResubmitItem(it: Pick<Item, 'requesterId' | 'status' | 'version' | 'review'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  return !c.archived && it.requesterId === c.userId && b.status === 'reviewing' && it.status === 'returned' && isEditedSinceReturn(it);
}

/** Resubmit is offered (maybe disabled) to the requester of a returned item in a reviewing batch. */
export function showResubmit(it: Pick<Item, 'requesterId' | 'status'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  return !c.archived && it.requesterId === c.userId && b.status === 'reviewing' && it.status === 'returned';
}

/** Reviewing: approvers and team admins (system admins are not implicit approvers on the backend). */
export function canReview(b: Batch, c: Caller): boolean {
  if (c.archived || b.status !== 'reviewing') return false;
  return isTeamAdmin(c) || b.assignments.approvers.includes(c.userId);
}

export function canForceReject(it: Pick<Item, 'status'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  return !c.archived && canAdmin(c) && b.status === 'reviewing' && (it.status === 'pending' || it.status === 'returned');
}

/**
 * Mirrors backend MarkUnpurchasable: purchasers and team admins (system admins have no implicit purchaser role),
 * batch `ordering`, item `approved` and not part of an order.
 */
export function canMarkUnpurchasable(it: Pick<Item, 'status' | 'orderId'>, b: Pick<Batch, 'status' | 'assignments'>, c: Caller): boolean {
  if (c.archived || b.status !== 'ordering' || it.status !== 'approved' || it.orderId) return false;
  return isTeamAdmin(c) || b.assignments.purchasers.includes(c.userId);
}
