import i18n from '../i18n';

/**
 * A timestamp for display, short and without seconds (the team's DESIGN.md: Data pages): `11/23 03:34`
 * this year, with the year otherwise. `time: false` leaves the time out where only the day matters.
 */
export function shortDate(iso: string | null | undefined, { time = true, now = new Date() }: { time?: boolean; now?: Date } = {}): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  if (time) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // en-US puts a comma between day and time; the short form has none.
  return d.toLocaleString(i18n.language || undefined, opts).replace(', ', ' ');
}
