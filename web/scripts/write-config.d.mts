import type { AppConfig } from '../src/configSchema';
export interface Env {
  [key: string]: string | undefined;
}
export const COMPATIBILITY_DATE: string;
export function prepare(raw: string | undefined): { config: AppConfig; headers: string };
export function buildWrangler(env: Env): Record<string, unknown>;
export function writeConfig(env: Env, root: string): void;
