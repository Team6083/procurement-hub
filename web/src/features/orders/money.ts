import { fractionDigits, currencyFractionDigits } from '../money';

/** An exact decimal string as a currency amount for display ("12.5" → "$12.50"); null shows as a dash. */
export function formatMoney(amount: string | null | undefined, currency: string, locale?: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const digits = currencyFractionDigits(currency) ?? 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, fractionDigits(amount)),
    }).format(amount as never);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** A plain decimal (a conversion factor) without currency, trimmed. */
export function formatFactor(f: string | null | undefined): string {
  if (!f) return '—';
  return f.includes('.') ? f.replace(/0+$/, '').replace(/\.$/, '') : f;
}
