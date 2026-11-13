import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { ifMatchHeader, isVersionConflict, parseEtag, refetchOnConflict } from './versioned';

describe('parseEtag', () => {
  it('parses quoted, weak and bare versions', () => {
    expect(parseEtag('"3"')).toBe(3);
    expect(parseEtag('W/"12"')).toBe(12);
    expect(parseEtag('7')).toBe(7);
  });
  it('rejects missing or invalid values', () => {
    expect(parseEtag(null)).toBeUndefined();
    expect(parseEtag('')).toBeUndefined();
    expect(parseEtag('"abc"')).toBeUndefined();
    expect(parseEtag('"0"')).toBeUndefined();
    expect(parseEtag('"1.5"')).toBeUndefined();
  });
});

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
  it('refetches every given query on conflict', () => {
    const qc = { invalidateQueries: vi.fn() };
    expect(refetchOnConflict(qc, conflict, [['team', '1'], ['teams']])).toBe(true);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['team', '1'] });
  });
  it('does nothing for other errors', () => {
    const qc = { invalidateQueries: vi.fn() };
    expect(refetchOnConflict(qc, new ApiError(403, 'forbidden', 'x'), [['team', '1']])).toBe(false);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });
});
