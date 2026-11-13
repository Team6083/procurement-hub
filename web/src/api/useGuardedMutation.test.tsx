import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { useGuardedMutation } from './useGuardedMutation';

function setup(mutationFn: () => Promise<string>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(
    () => useGuardedMutation<void, string>({ mutationFn, invalidate: [['members']], conflictKeys: [['team', '1']] }),
    { wrapper },
  );
  return { hook, spy };
}

describe('useGuardedMutation', () => {
  it('on version_conflict surfaces the error and refetches stale queries', async () => {
    const { hook, spy } = setup(() => Promise.reject(new ApiError(409, 'version_conflict', 'x')));
    await act(async () => {
      hook.result.current.mutate();
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect((hook.result.current.error as ApiError).code).toBe('version_conflict');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['members'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['team', '1'] });
  });

  it('does not refetch on other errors', async () => {
    const { hook, spy } = setup(() => Promise.reject(new ApiError(422, 'team_archived', 'x')));
    await act(async () => {
      hook.result.current.mutate();
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });

  it('on success invalidates only the success keys', async () => {
    const { hook, spy } = setup(() => Promise.resolve('ok'));
    await act(async () => {
      hook.result.current.mutate();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['members'] });
  });
});
