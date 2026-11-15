import type { Batch, ExceptionAction, ExceptionRequest, ExceptionType, Item, ReceiptRequest, ResolveExceptionRequest } from '../../api/types';
import { isMember, isTeamAdmin, type Caller } from '../batches/rules';
import { validateAmount, type AmountError } from '../money';
import { isPurchaser } from '../orders/rules';

export const MAX_RECEIPT_NOTE = 500;
export const MAX_EXCEPTION_DESCRIPTION = 2000;
export const MAX_RESOLVE_NOTE = 1000;
export const EXCEPTION_TYPES: ExceptionType[] = ['quantity_mismatch', 'wrong_item', 'damaged'];
export const EXCEPTION_ACTIONS: ExceptionAction[] = ['exchange', 'accept', 'cancel'];

/** The tab shows once goods can arrive, and stays for the record after the batch completes. */
export const isReceivingStage = (b: Pick<Batch, 'status'>) => b.status === 'receiving' || b.status === 'completed';

/** Members and system admins see the tab (system admins read only, they have no implicit role). */
export const canSeeReceiving = (b: Pick<Batch, 'status'>, c: Caller) => isReceivingStage(b) && (isMember(c) || c.isSystemAdmin);

/** Receivers, purchasers and team admins record receipts and report problems (spec 8). */
export function isReceiver(b: Pick<Batch, 'assignments'>, c: Caller): boolean {
  return !c.archived && isMember(c) && (isTeamAdmin(c) || b.assignments.receivers.includes(c.userId) || b.assignments.purchasers.includes(c.userId));
}

export const canReceive = (b: Pick<Batch, 'status' | 'assignments'>, c: Caller) => b.status === 'receiving' && isReceiver(b, c);

/** Dispositions are for purchasers and team admins. */
export const canResolve = (b: Pick<Batch, 'status' | 'assignments'>, c: Caller) => b.status === 'receiving' && isPurchaser(b, c);

export const isToReceive = (i: Pick<Item, 'status'>) => i.status === 'ordered' || i.status === 'partially_received';
export const isOpenException = (i: Pick<Item, 'status'>) => i.status === 'exception';
export const isReceivingClosed = (i: Pick<Item, 'status'>) => i.status === 'received' || i.status === 'accepted_short' || i.status === 'not_obtained';

export const toReceive = (items: Item[]) => items.filter(isToReceive);
export const openExceptionItems = (items: Item[]) => items.filter(isOpenException);
export const closedItems = (items: Item[]) => items.filter(isReceivingClosed);

/** Units still to arrive. */
export const remainingQuantity = (i: Pick<Item, 'quantity' | 'receivedQuantity'>) => Math.max(0, i.quantity - i.receivedQuantity);

export type ReceiptError = 'format' | 'min' | 'exceeds';

export interface ReceiptCheck {
  body: ReceiptRequest;
  quantityError: ReceiptError | null;
  noteTooLong: boolean;
  valid: boolean;
}

/** A whole number from 1 up to what is still outstanding. Extra goods are an exception, not a receipt. */
export function checkReceipt(quantity: string, note: string, remaining: number): ReceiptCheck {
  const q = quantity.trim();
  const n = /^\d+$/.test(q) ? Number(q) : NaN;
  const quantityError: ReceiptError | null = !Number.isSafeInteger(n) ? 'format' : n < 1 ? 'min' : n > remaining ? 'exceeds' : null;
  const trimmed = note.trim();
  const noteTooLong = trimmed.length > MAX_RECEIPT_NOTE;
  return {
    body: { quantity: n, ...(trimmed ? { note: trimmed } : {}) },
    quantityError,
    noteTooLong,
    valid: quantityError === null && !noteTooLong,
  };
}

export interface ExceptionCheck {
  body: ExceptionRequest;
  descriptionError: 'required' | 'tooLong' | null;
  valid: boolean;
}

export function checkException(type: ExceptionType, description: string): ExceptionCheck {
  const d = description.trim();
  const descriptionError = d === '' ? 'required' : d.length > MAX_EXCEPTION_DESCRIPTION ? 'tooLong' : null;
  return { body: { type, description: d }, descriptionError, valid: descriptionError === null };
}

export interface ResolveForm {
  action: ExceptionAction;
  note: string;
  refund: string;
}

export interface ResolveCheck {
  body: ResolveExceptionRequest;
  /** Accepting what arrived needs something to have arrived: cancel instead. */
  nothingReceived: boolean;
  noteError: 'required' | 'tooLong' | null;
  refundError: AmountError | null;
  valid: boolean;
}

/**
 * `exchange` takes neither note nor refund. `accept` and `cancel` need a note (it becomes the close reason) and may record
 * a positive base-currency refund.
 */
export function checkResolve(f: ResolveForm, receivedQuantity: number, baseDigits: number | undefined): ResolveCheck {
  if (f.action === 'exchange') {
    return { body: { action: 'exchange' }, nothingReceived: false, noteError: null, refundError: null, valid: true };
  }
  const note = f.note.trim();
  const noteError = note === '' ? 'required' : note.length > MAX_RESOLVE_NOTE ? 'tooLong' : null;
  const refund = f.refund.trim();
  const refundError = refund === '' ? null : validateAmount(refund, { sign: 'nonNegative', nonZero: true, digits: baseDigits });
  const nothingReceived = f.action === 'accept' && receivedQuantity < 1;
  return {
    body: { action: f.action, note, ...(refund && !refundError ? { refundAmountBase: refund } : {}) },
    nothingReceived,
    noteError,
    refundError,
    valid: noteError === null && refundError === null && !nothingReceived,
  };
}
