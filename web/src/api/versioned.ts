import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { useApi } from './context';
import { ApiError } from '@team6083/ui';
import { useGuardedMutation } from './useGuardedMutation';

/*
 * Versions (If-Match). Every write sends the version of the resource it changes, read from that resource's own
 * `version` field:
 * - records written as a whole (batch, team, me, vendor order, delivery): the version in the cached record when the
 *   write runs, through useVersionedMutation;
 * - records in a list (items, members, vendors, rates, problems, role mappings): the `version` of the row the user
 *   acted on, passed in by the caller.
 */

/** Builds the `If-Match` request header for a resource version. */
export function ifMatchHeader(version: number | undefined): Record<string, string> {
  if (version === undefined) return {};
  return { 'If-Match': `"${version}"` };
}

export function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 412 || (err.status === 409 && err.code === 'version_conflict'));
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs writes with the same key one after another, so each reads the version the previous one produced and quickly
 * editing several prices never races itself into a version conflict.
 */
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(key, next);
  return next;
}

/**
 * A write on a cached record: If-Match is the cached record's `version` when the write runs (after earlier writes
 * on the same record), and the returned record replaces the cache before the next queued write starts.
 */
export function useVersionedMutation<TVars, T extends { version: number }>(
  key: QueryKey,
  call: (api: ApiClient, vars: TVars, version: number | undefined) => Promise<T>,
) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, T>({
    mutationFn: (vars) =>
      serial(JSON.stringify(key), async () => {
        const r = await call(api, vars, qc.getQueryData<{ version?: number }>(key)?.version);
        qc.setQueryData(key, r);
        return r;
      }),
  });
}
