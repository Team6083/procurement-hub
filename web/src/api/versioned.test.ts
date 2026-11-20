import { describe, expect, it } from 'vitest';
import { ApiError } from '@team6083/ui';
import { ifMatchHeader, isVersionConflict } from './versioned';

describe('ifMatchHeader', () => {
  it('quotes the version', () => expect(ifMatchHeader(4)).toEqual({ 'If-Match': '"4"' }));
  it('omits the header without a version (server answers 428)', () => expect(ifMatchHeader(undefined)).toEqual({}));
});

describe('409 version_conflict flow', () => {
  const conflict = new ApiError(409, 'version_conflict', 'x');
  it('detects only version conflicts', () => {
    expect(isVersionConflict(conflict)).toBe(true);
    expect(isVersionConflict(new ApiError(409, 'invalid_transition', 'x'))).toBe(false);
    expect(isVersionConflict(new ApiError(422, 'team_archived', 'x'))).toBe(false);
    expect(isVersionConflict(new Error('x'))).toBe(false);
  });
  it('treats 412 as a stale version too', () => expect(isVersionConflict(new ApiError(412, 'precondition_failed', 'x'))).toBe(true));
});
