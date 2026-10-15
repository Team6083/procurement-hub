import { describe, expect, it } from 'vitest';
import { add, format, mul, mulInt, parseDec, toFixed } from './decimal';
import { estimate, lineTotal } from './estimates';

describe('decimal', () => {
  it('is exact where floats are not', () => {
    expect(toFixed(add(parseDec('0.1'), parseDec('0.2')), 1)).toBe('0.3');
    expect(format(add(parseDec('0.1'), parseDec('0.2')))).toBe('0.30');
  });
  it('parses and rejects', () => {
    expect(parseDec('-3.25')).toEqual({ n: -325n, s: 2 });
    expect(parseDec('.5')).toEqual({ n: 5n, s: 1 });
    for (const bad of ['', 'abc', '1e3', '1,5', '.']) expect(() => parseDec(bad)).toThrow();
  });
  it('rounds half away from zero', () => {
    expect(toFixed(parseDec('1.005'), 2)).toBe('1.01');
    expect(toFixed(parseDec('1.004'), 2)).toBe('1.00');
    expect(toFixed(parseDec('-1.005'), 2)).toBe('-1.01');
    expect(toFixed(parseDec('2'), 2)).toBe('2.00');
    expect(toFixed(parseDec('0.999'), 0)).toBe('1');
    expect(toFixed(parseDec('-0.001'), 2)).toBe('0.00');
  });
  it('multiplies', () => {
    expect(format(mul(parseDec('1.5'), parseDec('2.25')))).toBe('3.375');
    expect(format(mulInt(parseDec('19.99'), 3))).toBe('59.97');
  });
  it('formats with at least two decimals', () => {
    expect(format(parseDec('12'))).toBe('12.00');
    expect(format(parseDec('12.500'))).toBe('12.50');
    expect(format(parseDec('12.125'))).toBe('12.125');
  });
});

const item = (q: number, amount: string, currency: string) => ({ quantity: q, estimatedUnitPrice: { amount, currency } });

describe('estimates', () => {
  it('line total is quantity x unit price', () => {
    expect(format(lineTotal(item(3, '0.10', 'USD')))).toBe('0.30');
  });
  it('sums per currency, converts with reference rates and buckets rate-less currencies', () => {
    const items = [item(2, '10', 'TWD'), item(3, '1.10', 'USD'), item(1, '5', 'EUR'), item(1, '0.1', 'USD')];
    const e = estimate(items, [{ currency: 'USD', rateToBase: '30.5' }], 'TWD');
    expect(e.byCurrency).toEqual([
      { currency: 'EUR', amount: '5.00' },
      { currency: 'TWD', amount: '20.00' },
      { currency: 'USD', amount: '3.40' },
    ]);
    expect(e.base).toBe('123.70'); // 20 + 3.4 * 30.5
    expect(e.noRate).toEqual([{ currency: 'EUR', amount: '5.00' }]);
  });
  it('handles no items and base-only', () => {
    expect(estimate([], [], 'TWD')).toEqual({ byCurrency: [], base: '0.00', noRate: [] });
    expect(estimate([item(1, '7', 'TWD')], [], 'TWD').noRate).toEqual([]);
  });
  it('does not drift on many small items', () => {
    const items = Array.from({ length: 1000 }, () => item(1, '0.1', 'USD'));
    expect(estimate(items, [{ currency: 'USD', rateToBase: '1' }], 'TWD').base).toBe('100.00');
  });
});
