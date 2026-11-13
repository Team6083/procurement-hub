import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ApiError } from './errors';

/** Parses an `ETag` header (`"3"`, `W/"3"`) into the numeric resource version. */
export function parseEtag(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const v = Number(header.trim().replace(/^W\//, '').replace(/^"|"$/g, ''));
  return Number.isInteger(v) && v >= 1 ? v : undefined;
}

/** Builds the `If-Match` request header for a resource version. */
export function ifMatchHeader(version: number | undefined): Record<string, string> {
  if (version === undefined) return {};
  return { 'If-Match': `"${version}"` };
}

export function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'version_conflict';
}

/**
 * Error handler for versioned mutations: on 409 version_conflict the cached copies
 * are stale, so they are refetched. Returns true when a refetch was triggered.
 */
export function refetchOnConflict(qc: Pick<QueryClient, 'invalidateQueries'>, err: unknown, keys: QueryKey[]): boolean {
  if (!isVersionConflict(err)) return false;
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  return true;
}

/** A cached resource together with the version from its `ETag` header. */
export interface Versioned<T> {
  data: T;
  etag: number | undefined;
}
