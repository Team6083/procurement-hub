import { describe, expect, it } from 'vitest';
import { requiresCommit, resolveCommit, resolveCommitStrict } from './commit.mjs';

describe('resolveCommit', () => {
  const git = () => 'gitsha\n';
  it('prefers APP_COMMIT, then CF, then Workers, then git', () => {
    expect(resolveCommit({ APP_COMMIT: 'a', CF_PAGES_COMMIT_SHA: 'b', WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('a');
    expect(resolveCommit({ APP_COMMIT: '', CF_PAGES_COMMIT_SHA: 'b', WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('b');
    expect(resolveCommit({ WORKERS_CI_COMMIT_SHA: 'c' }, git)).toBe('c');
    expect(resolveCommit({}, git)).toBe('gitsha');
  });
  it('falls back to unknown', () => {
    expect(resolveCommit({}, () => '')).toBe('unknown');
  });
});

describe('production commit requirement (spec §6.3)', () => {
  it('detects production builds from NODE_ENV or CI', () => {
    expect(requiresCommit({})).toBe(false);
    expect(requiresCommit({ NODE_ENV: 'development' })).toBe(false);
    expect(requiresCommit({ NODE_ENV: 'test' })).toBe(false);
    expect(requiresCommit({ CI: 'false' })).toBe(false);
    expect(requiresCommit({ CI: '' })).toBe(false);
    expect(requiresCommit({ NODE_ENV: 'production' })).toBe(true);
    expect(requiresCommit({ CI: 'true' })).toBe(true);
    expect(requiresCommit({ CI: 'TRUE' })).toBe(true);
    expect(requiresCommit({ CI: '1' })).toBe(true);
  });
  it('fails a production build with no commit and names all four sources', () => {
    for (const env of [{ NODE_ENV: 'production' }, { CI: 'true' }, { CI: '1' }]) {
      expect(() => resolveCommitStrict(env, () => '')).toThrow(
        /APP_COMMIT.*CF_PAGES_COMMIT_SHA.*WORKERS_CI_COMMIT_SHA.*git rev-parse HEAD/,
      );
    }
    expect(() => resolveCommitStrict({}, () => '', true)).toThrow();
  });
  it('still succeeds in production when any source yields a commit', () => {
    expect(resolveCommitStrict({ CI: 'true', APP_COMMIT: 'abc' }, () => '')).toBe('abc');
    expect(resolveCommitStrict({ NODE_ENV: 'production' }, () => 'gitsha')).toBe('gitsha');
    expect(resolveCommitStrict({ CI: 'true', WORKERS_CI_COMMIT_SHA: 'w' }, () => '')).toBe('w');
  });
  it('keeps "unknown" for local development and tests', () => {
    expect(resolveCommitStrict({}, () => '')).toBe('unknown');
    expect(resolveCommitStrict({ NODE_ENV: 'test' }, () => '')).toBe('unknown');
  });
});
