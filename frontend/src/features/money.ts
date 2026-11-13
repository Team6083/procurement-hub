/** Number of digits after the decimal point in a plain decimal string ("12.50" -> 2, "7" -> 0). */
export function fractionDigits(s: string): number {
  const i = s.trim().indexOf('.');
  return i < 0 ? 0 : s.trim().length - i - 1;
}

/**
 * Minor-unit digits of a currency as the browser knows them (ISO 4217 via Intl). A client-side hint only:
 * the server may use a different value for the base currency (APP_BASE_CURRENCY_DECIMALS) and stays authoritative.
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
