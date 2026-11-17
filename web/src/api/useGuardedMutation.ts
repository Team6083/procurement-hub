import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isVersionConflict } from './versioned';

interface Options<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void;
}

/**
 * useMutation for every write in the app. A successful write refetches everything (queryClient.ts); a 409
 * version_conflict means what is on screen is stale, so everything is refetched then too. Forms keep the user's
 * edits through that refetch (they re-seed only the fields the user did not touch) and show the conflict error.
 */
export function useGuardedMutation<TVars, TData = unknown>(o: Options<TVars, TData>) {
  const qc = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: o.mutationFn,
    onSuccess: o.onSuccess,
    onError: (err) => {
      if (isVersionConflict(err)) void qc.invalidateQueries();
    },
  });
}
