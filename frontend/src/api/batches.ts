import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './context';
import type {
  AssignmentsRequest, AuditEvent, Batch, BatchAction, Item, ItemRequest, MyTasks, Page, PatchBatchRequest, ReviewRequest, ReviewResult,
} from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, type Versioned } from './versioned';

export interface BatchFilters {
  teamId?: string;
  status?: string;
  q?: string;
}

export const batchesKey = ['batches'] as const;
export const batchKey = (id: string | undefined) => ['batch', id] as const;
export const itemsKey = (id: string | undefined) => ['batch', id, 'items'] as const;
export const auditKey = (id: string | undefined) => ['batch', id, 'audit'] as const;
export const tasksKey = ['tasks'] as const;

/** GET /batches with cursor pagination ("load more"). */
export function useBatchList(filters: BatchFilters) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...batchesKey, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<Batch>>('/batches', {
        query: { teamId: filters.teamId || undefined, status: filters.status || undefined, q: filters.q?.trim() || undefined, cursor: pageParam, limit: 25 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useBatch(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: batchKey(id),
    enabled: !!id,
    queryFn: async ({ signal }): Promise<Versioned<Batch>> => {
      const r = await api.full.get<Batch>(`/batches/${id}`, { signal });
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
  });
}

export function useItems(batchId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: itemsKey(batchId),
    enabled: !!batchId,
    queryFn: async ({ signal }) => (await api.get<Page<Item>>(`/batches/${batchId}/items`, { signal })).items,
  });
}

export function useBatchAudit(batchId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: auditKey(batchId),
    enabled: !!batchId,
    queryFn: async ({ signal }) =>
      (await api.get<Page<AuditEvent>>('/audit', { query: { objectType: 'batch', objectId: batchId }, signal })).items,
  });
}

export function useMyTasks() {
  const api = useApi();
  return useQuery({ queryKey: tasksKey, queryFn: ({ signal }) => api.get<MyTasks>('/me/tasks', { signal }) });
}

export function useCreateBatch(teamId: string) {
  const api = useApi();
  return useGuardedMutation<{ title: string; description: string; propose: boolean }, Batch>({
    mutationFn: (body) => api.post<Batch>(`/teams/${teamId}/batches`, body),
    invalidate: [batchesKey, tasksKey],
  });
}

/** Mutation on a batch: If-Match from the cached ETag; response replaces the cache; conflict refetches. */
function useBatchCall<TVars>(
  batchId: string,
  call: (api: ReturnType<typeof useApi>, headers: Record<string, string>, vars: TVars) => Promise<{ data: Batch; etag: number | undefined }>,
) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, Versioned<Batch>>({
    mutationFn: async (vars) => {
      const cached = qc.getQueryData<Versioned<Batch>>(batchKey(batchId));
      const r = await call(api, ifMatchHeader(cached?.etag), vars);
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
    invalidate: [batchesKey, tasksKey, auditKey(batchId), itemsKey(batchId)],
    conflictKeys: [batchKey(batchId)],
    onSuccess: (v) => qc.setQueryData(batchKey(batchId), v),
  });
}

export const useTransition = (batchId: string) =>
  useBatchCall<{ action: BatchAction; reason?: string; deadline?: string }>(batchId, (api, headers, body) =>
    api.full.post<Batch>(`/batches/${batchId}/transitions`, body, { headers }),
  );

export const usePatchBatch = (batchId: string) =>
  useBatchCall<PatchBatchRequest>(batchId, (api, headers, body) => api.full.patch<Batch>(`/batches/${batchId}`, body, { headers }));

export const useSetAssignments = (batchId: string) =>
  useBatchCall<AssignmentsRequest>(batchId, (api, headers, body) =>
    api.full.put<Batch>(`/batches/${batchId}/assignments`, body, { headers }),
  );

function useItemsChanged(batchId: string) {
  return { invalidate: [itemsKey(batchId), batchKey(batchId), batchesKey, tasksKey, auditKey(batchId)] };
}

export function useAddItem(batchId: string) {
  const api = useApi();
  return useGuardedMutation<ItemRequest, Item>({
    mutationFn: (body) => api.post<Item>(`/batches/${batchId}/items`, body),
    ...useItemsChanged(batchId),
  });
}

export function usePatchItem(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ item: Item; body: ItemRequest }, Item>({
    mutationFn: ({ item, body }) => api.patch<Item>(`/items/${item.id}`, body, { headers: ifMatchHeader(item.version) }),
    ...useItemsChanged(batchId),
  });
}

export function useItemAction(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ item: Item; action: 'withdraw' | 'resubmit' | 'force-reject'; reason?: string }, Item>({
    mutationFn: ({ item, action, reason }) =>
      api.post<Item>(`/items/${item.id}/${action}`, action === 'force-reject' ? { reason } : undefined, { headers: ifMatchHeader(item.version) }),
    ...useItemsChanged(batchId),
  });
}

export function useReview(batchId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<ReviewRequest, Versioned<Batch>>({
    mutationFn: async (body) => {
      const r = await api.full.post<ReviewResult>(`/batches/${batchId}/reviews`, body);
      return { data: r.data.batch, etag: r.etag ?? r.data.batch.version };
    },
    ...useItemsChanged(batchId),
    onSuccess: (v) => qc.setQueryData(batchKey(batchId), v),
  });
}

