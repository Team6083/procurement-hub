import type { AdjustmentRequest } from '../../api/types';
import { validateAmount, type AmountError } from '../money';
import { MAX_REASON_LENGTH } from './rules';

export interface AdjustmentForm {
  amountBase: string;
  reason: string;
  /** '' = the whole order */
  itemId: string;
}

export interface AdjustmentCheck {
  body: AdjustmentRequest;
  amountError: AmountError | null;
  reasonError: 'required' | 'tooLong' | null;
  valid: boolean;
}

/** A non-zero base-currency amount (refunds are negative) and a reason are required. */
export function checkAdjustment(f: AdjustmentForm, baseDigits: number | undefined): AdjustmentCheck {
  const amountError = validateAmount(f.amountBase, { sign: 'any', nonZero: true, digits: baseDigits });
  const reason = f.reason.trim();
  const reasonError = reason === '' ? 'required' : reason.length > MAX_REASON_LENGTH ? 'tooLong' : null;
  return {
    body: { amountBase: f.amountBase.trim(), reason, ...(f.itemId ? { itemId: f.itemId } : {}) },
    amountError,
    reasonError,
    valid: amountError === null && reasonError === null,
  };
}
