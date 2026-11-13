export interface Env {
  [key: string]: string | undefined;
}
export const COMMIT_SOURCES: string[];
export function resolveCommit(env: Env, gitRevParse?: () => string): string;
export function requiresCommit(env: Env): boolean;
export function resolveCommitStrict(env: Env, gitRevParse?: () => string, force?: boolean): string;
