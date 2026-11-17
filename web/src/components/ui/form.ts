import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { validateAmount, type AmountRules } from '../../features/money';

/*
 * The one form pattern of the app: react-hook-form with a zod schema, validated on submit (then again on every
 * change), the error under its field, `required` on every required FormField, and the submit button always enabled.
 * Schema messages are i18n keys, translated where they are shown with useFieldError().
 */

/** A required text: blank (after trimming) fails with "required". */
export const requiredText = (max?: number) => {
  const s = z.string().trim().min(1, 'common:validation.required');
  return max ? s.max(max, 'common:validation.tooLong') : s;
};

/** A whole number of at least 1, typed as text. */
export const positiveInt = (message = 'common:validation.invalid') => z.string().trim().regex(/^[1-9]\d*$/, message);

/** A decimal amount typed as text, checked with validateAmount; `optional` also accepts a blank field. */
export function amountText(rules: AmountRules, optional = false) {
  return z.string().superRefine((v, ctx) => {
    if (optional && !v.trim()) return;
    const e = validateAmount(v, rules);
    if (e) ctx.addIssue({ code: 'custom', message: `purchasing:amount.${e}` });
  });
}

/** Translates a field's error (a schema message key) for FormField's errorText. */
export function useFieldError() {
  const { t } = useTranslation();
  return useCallback((e: { message?: string } | undefined) => (e?.message ? t(e.message) : undefined), [t]);
}
