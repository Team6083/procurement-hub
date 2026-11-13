// Build commit resolution (spec section 6.3), used by vite.config.ts for __APP_COMMIT__.
// The commit SHA is the frontend/backend version comparison key, so a production build
// must never ship "unknown".
import { execSync } from 'node:child_process';

const nonEmpty = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

export const COMMIT_SOURCES = ['APP_COMMIT', 'CF_PAGES_COMMIT_SHA', 'WORKERS_CI_COMMIT_SHA', 'git rev-parse HEAD'];

/** First non-empty of APP_COMMIT, CF_PAGES_COMMIT_SHA, WORKERS_CI_COMMIT_SHA, git HEAD; else "unknown". */
export function resolveCommit(env, gitRevParse = gitHead) {
  return (
    nonEmpty(env.APP_COMMIT) ??
    nonEmpty(env.CF_PAGES_COMMIT_SHA) ??
    nonEmpty(env.WORKERS_CI_COMMIT_SHA) ??
    nonEmpty(gitRevParse()) ??
    'unknown'
  );
}

/** True for production builds: NODE_ENV=production, or CI=true/1 (case-insensitive). */
export function requiresCommit(env) {
  const ci = String(env.CI ?? '').trim().toLowerCase();
  return env.NODE_ENV === 'production' || ci === 'true' || ci === '1';
}

/**
 * Like resolveCommit, but throws in production builds (NODE_ENV=production or CI) when no
 * commit can be determined, so "unknown" never reaches a release. `force` marks a build that is
 * production regardless of env (e.g. `vite build`).
 */
export function resolveCommitStrict(env, gitRevParse = gitHead, force = false) {
  const commit = resolveCommit(env, gitRevParse);
  if (commit === 'unknown' && (force || requiresCommit(env))) {
    throw new Error(
      `Cannot determine the build commit for a production build. Set one of: ${COMMIT_SOURCES.join(', ')} ` +
        '(checked in this order). The commit SHA is the frontend/backend version comparison key (spec section 6.3).',
    );
  }
  return commit;
}
