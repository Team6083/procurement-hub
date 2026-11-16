import { describe, expect, it } from 'vitest';
import { itemFormSchema, emptyItemForm } from './batches/itemForm';
import { currencyFractionDigits, fractionDigits, validateAmount } from './money';

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
});

describe('validateAmount', () => {
  it('accepts plain decimals and rejects other text', () => {
    expect(validateAmount('12.50')).toBeNull();
    expect(validateAmount(' 7 ')).toBeNull();
    expect(validateAmount('.5')).toBeNull();
    for (const bad of ['', 'abc', '1,5', '1.', '+3', '1e3', '--2']) expect(validateAmount(bad)).toBe('format');
  });
  it('applies the sign rules', () => {
    expect(validateAmount('-1')).toBe('negative');
    expect(validateAmount('-1', { sign: 'any' })).toBeNull();
    expect(validateAmount('-1', { sign: 'nonPositive' })).toBeNull();
    expect(validateAmount('1', { sign: 'nonPositive' })).toBe('positive');
    expect(validateAmount('0', { sign: 'nonPositive' })).toBeNull();
  });
  it('can reject zero in any spelling', () => {
    for (const z of ['0', '0.00', '-0', '.0']) expect(validateAmount(z, { sign: 'any', nonZero: true })).toBe('zero');
    expect(validateAmount('0.01', { sign: 'any', nonZero: true })).toBeNull();
  });
  it('limits decimal places', () => {
    expect(validateAmount('1.234', { digits: 2 })).toBe('digits');
    expect(validateAmount('1.23', { digits: 2 })).toBeNull();
    expect(validateAmount('100', { digits: 0 })).toBeNull();
    expect(validateAmount('100.5', { digits: 0 })).toBe('digits');
  });
});
