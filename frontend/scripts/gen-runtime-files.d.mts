export interface RuntimeEnv {
  [key: string]: string | undefined;
}
export function resolveCommit(env: RuntimeEnv, gitRevParse?: () => string): string;
export function buildConfig(env: RuntimeEnv): Record<string, unknown> | null;
export function buildCsp(env: RuntimeEnv): string;
export function buildHeaders(env: RuntimeEnv): string;
export function generate(env: RuntimeEnv, distDir: string): { configWritten: boolean };
export function requiresCommit(env: RuntimeEnv): boolean;
export const COMMIT_SOURCES: string[];
export function resolveCommitStrict(env: RuntimeEnv, gitRevParse?: () => string, force?: boolean): string;
