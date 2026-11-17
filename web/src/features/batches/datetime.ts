import { z } from 'zod';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO timestamp -> value for <input type="datetime-local">, in the browser's local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * <input type="datetime-local"> value (local wall time, no offset) -> RFC 3339 UTC timestamp.
 * Empty input gives null; anything unparseable gives undefined.
 */
export function fromLocalInput(value: string): string | null | undefined {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, Number.isNaN(s) ? 0 : s);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The deadline to send when the field was edited, or undefined when it still shows the stored
 * value. Compared as displayed (minute precision), so opening and saving without touching the
 * field never rewrites a deadline that has seconds.
 */
export function deadlineChange(stored: string | null | undefined, input: string): string | null | undefined {
  if (input === toLocalInput(stored)) return undefined;
  return fromLocalInput(input);
}

/**
 * A datetime-local field in a form schema: parses to an RFC 3339 UTC timestamp, or null when empty. Unparseable input
 * fails with "invalid", and an empty field fails with "required" when `required`.
 */
export function deadlineInput(required: boolean) {
  return z.string().transform((v, ctx) => {
    const parsed = fromLocalInput(v);
    if (parsed === undefined) ctx.addIssue({ code: 'custom', message: 'common:validation.invalid' });
    else if (parsed === null && required) ctx.addIssue({ code: 'custom', message: 'common:validation.required' });
    return parsed ?? null;
  });
}
