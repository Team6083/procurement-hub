import type { Batch, BatchAction, Item, Me, RoleOrNone } from '../../api/types';

/** The caller's standing relative to one batch's team. */
export interface Caller {
  userId: string;
  isSystemAdmin: boolean;
  /** Effective team role, undefined when not a member. */
  teamRole: RoleOrNone | undefined;
  archived: boolean;
  /** Global roles from the token (PURCHASER_ROLES / RECEIVER_ROLES); system admins do not hold them implicitly. */
  isPurchaser: boolean;
  isReceiver: boolean;
}

export function callerFor(me: Pick<Me, 'id' | 'isSystemAdmin' | 'memberships' | 'isPurchaser' | 'isReceiver'> | undefined, teamId: string, archived = false): Caller {
  const role = me?.memberships.find((m) => m.teamId === teamId)?.role;
  return { userId: me?.id ?? '', isSystemAdmin: !!me?.isSystemAdmin, teamRole: role || undefined, archived, isPurchaser: !!me?.isPurchaser, isReceiver: !!me?.isReceiver };
}

export const isTeamAdmin = (c: Caller) => c.teamRole === 'admin';
/** Mirrors the backend's CanAdminTeam: team admin or system admin. */
export const canAdmin = (c: Caller) => isTeamAdmin(c) || c.isSystemAdmin;
export const isMember = (c: Caller) => !!c.teamRole;

export const isClosed = (b: Pick<Batch, 'status'>) => ['completed', 'cancelled', 'proposal_rejected'].includes(b.status);

export function assignmentsComplete(b: Pick<Batch, 'assignments'>): boolean {
  return b.assignments.approvers.length > 0; // purchasers are optional
}

export interface ActionAvailability {
  action: BatchAction;
  /** Present when the action is shown but its guard currently fails. */
  disabled?: 'assignments' | 'noPending' | 'undecided';
}

/**
 * Manual batch actions to offer. Permission and source-state mismatches are hidden;
 * guards the user can fix (assignments, pending items) show as disabled.
 * `pendingItems` undefined means unknown (items not loaded).
 */
export function availableActions(b: Batch, c: Caller, pendingItems?: number, undecidedItems?: number): ActionAvailability[] {
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
    // A withdrawn proposal is restored with restore_proposal, never uncancel (backend 409).
    if (s === 'cancelled' && b.statusBeforeCancel === 'proposed') out.push({ action: 'restore_proposal' });
    else if (s === 'cancelled' && b.statusBeforeCancel) out.push({ action: 'uncancel' });
    if (s === 'proposal_rejected') out.push({ action: 'restore_proposal' });
  }
  if (s === 'proposed' && b.origin === 'proposed' && b.createdBy === c.userId) out.push({ action: 'withdraw_proposal' });
  if (s === 'cancelled' && b.statusBeforeCancel === 'proposed' && b.origin === 'proposed' && b.createdBy === c.userId && !canAdmin(c)) {
    out.push({ action: 'restore_proposal' });
  }
  if (isApprover(b, c)) {
    if (s === 'reviewing') out.push({ action: 'confirm_review', ...(undecidedItems ? { disabled: 'undecided' as const } : {}) });
    if (b.reviewConfirmation && (s === 'purchasing' || s === 'receiving' || s === 'completed')) out.push({ action: 'unconfirm_review' });
  }
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

/** Approvers and team admins (system admins are not implicit approvers on the backend). */
export function isApprover(b: Pick<Batch, 'assignments'>, c: Caller): boolean {
  return isTeamAdmin(c) || b.assignments.approvers.includes(c.userId);
}

/** Reviewing: approvers and team admins (system admins are not implicit approvers on the backend). */
export function canReview(b: Batch, c: Caller): boolean {
  return !c.archived && b.status === 'reviewing' && isApprover(b, c);
}

export function canForceReject(it: Pick<Item, 'status'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  return !c.archived && canAdmin(c) && b.status === 'reviewing' && (it.status === 'pending' || it.status === 'returned');
}

/** Review confirmed, and not bought outside the system: purchasing applies to the batch. */
export const inPurchasing = (b: Pick<Batch, 'reviewConfirmation'>) => !!b.reviewConfirmation && !b.reviewConfirmation.purchaseOutside;

/** Mirrors backend MarkUnpurchasable: purchasers only, approved item of a review-confirmed batch, not yet marked. */
/** Only while something is left to purchase: the mark means "do not purchase the rest" (spec §10.2). */
export function canMarkUnpurchasable(it: Pick<Item, 'status' | 'unpurchasable' | 'toPurchaseQuantity'>, b: Pick<Batch, 'reviewConfirmation'>, c: Caller): boolean {
  return !c.archived && c.isPurchaser && inPurchasing(b) && it.status === 'approved' && !it.unpurchasable && it.toPurchaseQuantity > 0;
}

export function canUndoUnpurchasable(it: Pick<Item, 'status' | 'unpurchasable'>, b: Pick<Batch, 'reviewConfirmation'>, c: Caller): boolean {
  return !c.archived && c.isPurchaser && inPurchasing(b) && it.status === 'approved' && !!it.unpurchasable;
}

/** Undo a review decision: the reviewer who made it, or a team admin, before the review is confirmed. */
export function canUndoReview(it: Pick<Item, 'status' | 'review'>, b: Pick<Batch, 'status'>, c: Caller): boolean {
  if (c.archived || b.status !== 'reviewing' || !it.review) return false;
  if (!['approved', 'rejected', 'returned'].includes(it.status)) return false;
  return isTeamAdmin(c) || it.review.by === c.userId;
}

/** Copy a withdrawn item into a new one: its requester or a team admin, while the batch takes items. */
export function canCopyItem(it: Pick<Item, 'status' | 'requesterId'>, b: Batch, c: Caller): boolean {
  return it.status === 'withdrawn' && canAddItem(b, c) && (it.requesterId === c.userId || isTeamAdmin(c));
}
