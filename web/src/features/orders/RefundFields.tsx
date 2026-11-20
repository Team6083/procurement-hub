import { Input, Stack } from '@chakra-ui/react';
import { Controller, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useMeta } from '../../api/meta';
import { FormField } from '../../components/ui/field';
import { amountText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { currencyFractionDigits, validateAmount } from '../money';

/** Form values of the optional refund of a line closure or problem resolution. A blank amount means no refund. */
export interface RefundValues {
  refundCurrency: string;
  refund: string;
  refundActual: string;
  refundMethod: 'cash' | 'coupon';
  refundNote: string;
}

export const refundDefaults = (currency: string): RefundValues => ({ refundCurrency: currency, refund: '', refundActual: '', refundMethod: 'cash', refundNote: '' });

/** Zod fields for RefundValues; call `checkRefundAmount` in the object's superRefine. */
export const refundShape = (baseDigits: number) => ({
  refundCurrency: z.string(),
  refund: z.string(),
  refundActual: amountText({ digits: baseDigits, sign: 'nonNegative', nonZero: true }, true),
  refundMethod: z.enum(['cash', 'coupon']),
  refundNote: z.string(),
});

/** The amount is checked against the chosen currency's digits (positive, non-zero). */
export function checkRefundAmount(v: RefundValues, ctx: z.RefinementCtx) {
  if (!v.refund.trim()) return;
  const e = validateAmount(v.refund, { digits: currencyFractionDigits(v.refundCurrency) ?? 2, sign: 'nonNegative', nonZero: true });
  if (e) ctx.addIssue({ code: 'custom', path: ['refund'], message: `purchasing:amount.${e}` });
}

/** The request `refund` object, or null when no amount was typed. */
export function refundBody(v: RefundValues, baseCurrency: string) {
  if (!v.refund.trim()) return null;
  const actual = v.refundActual.trim();
  return {
    currency: v.refundCurrency,
    amount: v.refund.trim(),
    actualAmountBase: actual && v.refundCurrency !== baseCurrency ? actual : null,
    method: v.refundMethod,
    note: v.refundNote.trim() || undefined,
  };
}

/** Renders the refund fields of the surrounding react-hook-form context (a FormProvider whose values include RefundValues). */
export function RefundFields({ currency, baseCurrency }: { currency: string; baseCurrency: string }) {
  const { t } = useTranslation('purchasing');
  const { control, register, formState: { errors } } = useFormContext<RefundValues>();
  const meta = useMeta();
  const fieldError = useFieldError();
  const currencies = meta.data?.supportedCurrencies ?? [baseCurrency];
  return (
    <Stack gap="3">
      <Controller control={control} name="refundCurrency" render={({ field }) => (
        <SelectField label={t('refundInput.currency')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur} options={currencies} />
      )} />
      <FormField label={t('refundInput.amount', { currency })} helperText={t('refundInput.amountHelp')} errorText={fieldError(errors.refund)}>
        <Input inputMode="decimal" {...register('refund')} />
      </FormField>
      {currency !== baseCurrency && (
        <FormField label={t('refundInput.actual', { currency: baseCurrency })} helperText={t('refundInput.actualHelp')} errorText={fieldError(errors.refundActual)}>
          <Input inputMode="decimal" {...register('refundActual')} />
        </FormField>
      )}
      <Controller control={control} name="refundMethod" render={({ field }) => (
        <SelectField
          label={t('refundInput.method')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
          options={[{ value: 'cash', label: t('refundInput.cash') }, { value: 'coupon', label: t('refundInput.coupon') }]}
        />
      )} />
      <FormField label={t('refundInput.note')}>
        <Input {...register('refundNote')} />
      </FormField>
    </Stack>
  );
}
