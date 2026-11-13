import { describe, expect, it } from 'vitest';
import { itemFormSchema, emptyItemForm } from './batches/itemForm';
import { ratesSchema } from './teams/schemas';
import { currencyFractionDigits, fractionDigits } from './money';

describe('money hints', () => {
  it('counts fractional digits', () => {
    expect(fractionDigits('12')).toBe(0);
    expect(fractionDigits('12.50')).toBe(2);
    expect(fractionDigits('.125')).toBe(3);
  });
  it('knows ISO minor units', () => {
    expect(currencyFractionDigits('USD')).toBe(2);
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(currencyFractionDigits('not-a-currency')).toBeUndefined();
  });
  it('flags too many price decimals for the currency', () => {
    const base = { ...emptyItemForm('USD', ''), name: 'x', purpose: 'y' };
    expect(itemFormSchema.safeParse({ ...base, unitPrice: '1.25' }).success).toBe(true);
    expect(itemFormSchema.safeParse({ ...base, unitPrice: '1.255' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, currency: 'JPY', unitPrice: '100.5' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, currency: 'JPY', unitPrice: '100' }).success).toBe(true);
  });
  it('limits reference rates to 6 fractional digits', () => {
    const r = (v: string) => ratesSchema.safeParse({ rates: [{ currency: 'USD', rateToBase: v }] }).success;
    expect(r('30.123456')).toBe(true);
    expect(r('30.1234567')).toBe(false);
    expect(r('0')).toBe(false);
  });
});
