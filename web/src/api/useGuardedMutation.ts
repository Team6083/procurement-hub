import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { refetchOnConflict } from './versioned';

interface Options<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Queries to refetch after success and on a 409 version_conflict. */
  invalidate?: QueryKey[];
  /** Queries refetched only on a conflict (e.g. ones already updated from the response on success). */
  conflictKeys?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
}

/** useMutation that refetches stale data when the server reports a version conflict. */
export function useGuardedMutation<TVars, TData = unknown>(o: Options<TVars, TData>) {
  const qc = useQueryClient();
  const keys = o.invalidate ?? [];
  return useMutation<TData, Error, TVars>({
    mutationFn: o.mutationFn,
    onSuccess: (data, vars) => {
      o.onSuccess?.(data, vars);
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      refetchOnConflict(qc, err, [...keys, ...(o.conflictKeys ?? [])]);
    },
  });
}
