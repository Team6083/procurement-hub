/** Number of digits after the decimal point in a plain decimal string ("12.50" -> 2, "7" -> 0). */
export function fractionDigits(s: string): number {
  const i = s.trim().indexOf('.');
  return i < 0 ? 0 : s.trim().length - i - 1;
}

/**
 * Minor-unit digits of a currency as the browser knows them (ISO 4217 via Intl). A client-side hint only:
 * the server may use a different value for the base currency (BASE_CURRENCY_DECIMALS) and stays authoritative.
 */
export function currencyFractionDigits(currency: string): number | undefined {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return undefined;
  }
}

/** Maximum fractional digits of a reference rate (server limit). */
export const MAX_RATE_DIGITS = 6;

export type AmountError = 'format' | 'negative' | 'positive' | 'zero' | 'digits';

export interface AmountRules {
  /** Maximum fractional digits (a client-side hint; the server stays authoritative). */
  digits?: number;
  /** Which signs are accepted. Default "nonNegative". */
  sign?: 'nonNegative' | 'nonPositive' | 'any';
  /** Reject an amount equal to zero. */
  nonZero?: boolean;
}

/** Validates a typed decimal amount; returns an error kind (an i18n key suffix) or null. */
export function validateAmount(input: string, rules: AmountRules = {}): AmountError | null {
  const s = input.trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return 'format';
  const negative = s.startsWith('-');
  const zero = /^-?[0.]*$/.test(s);
  const sign = rules.sign ?? 'nonNegative';
  if (negative && !zero && sign === 'nonNegative') return 'negative';
  if (!negative && !zero && sign === 'nonPositive') return 'positive';
  if (zero && rules.nonZero) return 'zero';
  if (rules.digits !== undefined && fractionDigits(s) > rules.digits) return 'digits';
  return null;
}
