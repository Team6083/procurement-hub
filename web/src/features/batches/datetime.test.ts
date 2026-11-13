import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deadlineChange, fromLocalInput, toLocalInput } from './datetime';

// datetime-local shows and edits local wall time; the API takes and returns UTC.
describe('datetime-local conversion', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Taipei'; // UTC+8, no DST
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('displays a UTC timestamp in local time', () => {
    expect(toLocalInput('2026-03-01T16:30:00Z')).toBe('2026-03-02T00:30');
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('garbage')).toBe('');
  });

  it('sends local input as UTC', () => {
    expect(fromLocalInput('2026-03-02T00:30')).toBe('2026-03-01T16:30:00.000Z');
    expect(fromLocalInput('2026-03-02T00:30:15')).toBe('2026-03-01T16:30:15.000Z');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('2026-03-02')).toBeUndefined();
  });

  it('round-trips', () => {
    const iso = '2026-12-31T23:59:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('handles a DST zone', () => {
    process.env.TZ = 'America/New_York';
    expect(toLocalInput('2026-07-01T12:00:00Z')).toBe('2026-07-01T08:00'); // EDT, UTC-4
    expect(fromLocalInput('2026-01-15T08:00')).toBe('2026-01-15T13:00:00.000Z'); // EST, UTC-5
    process.env.TZ = 'Asia/Taipei';
  });

  it('reports a deadline change only when the shown value was edited', () => {
    const stored = '2026-03-01T16:30:45Z'; // has seconds, which datetime-local does not show
    expect(deadlineChange(stored, toLocalInput(stored))).toBeUndefined();
    expect(deadlineChange(stored, '2026-03-02T01:00')).toBe('2026-03-01T17:00:00.000Z');
    expect(deadlineChange(stored, '')).toBeNull();
    expect(deadlineChange(null, '')).toBeUndefined();
  });
});
