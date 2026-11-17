import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayLocal } from './dates';

describe('todayLocal', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Taipei'; // UTC+8
  });
  afterAll(() => {
    process.env.TZ = tz;
  });
  it('is the local date, not the UTC date, early in the morning', () => {
    // 07:30 on 11/18 in Taipei is still 11/17 in UTC.
    expect(todayLocal(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-18');
  });
  it('pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});
