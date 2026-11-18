import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { AUDIT_PAGE_SIZE, keys } from './keys';
import type {
  AssignmentsRequest, AuditEvent, Batch, BatchAction, Item, ItemRequest, ItemWithLines, MyTasks, Page, PatchBatchRequest, ReviewRequest, ReviewResult,
} from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, useVersionedMutation } from './versioned';

export interface BatchFilters {
  teamId?: string;
  status?: string;
  q?: string;
}


/** GET /batches with cursor pagination ("load more"). */
export function useBatchList(filters: BatchFilters) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.batches(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<Batch>>('/batches', {
        query: { teamId: filters.teamId || undefined, status: filters.status || undefined, q: filters.q?.trim() || undefined, cursor: pageParam, limit: 25 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** GET /batches/{id}; its `version` is the If-Match value for writes on the batch. */
export function useBatch(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: keys.batch(id), enabled: !!id, queryFn: ({ signal }) => api.get<Batch>(`/batches/${id}`, { signal }) });
}

export function useItems(batchId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: keys.items(batchId),
    enabled: !!batchId,
    // Purchasers and receivers outside the team get a restricted item projection without `lines`.
    queryFn: async ({ signal }) =>
      (await api.get<{ items: ItemWithLines[] }>(`/batches/${batchId}/items`, { signal })).items.map((i) => ({ ...i, lines: i.lines ?? [] })),
  });
}

/** Batch timeline (includes item events), newest first, cursor-paginated. */
export function useBatchAudit(batchId: string | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.batchAudit(batchId),
    enabled: !!batchId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<AuditEvent>>('/audit', { query: { objectType: 'batch', objectId: batchId, order: 'desc', limit: AUDIT_PAGE_SIZE, cursor: pageParam }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMyTasks() {
  const api = useApi();
  return useQuery({ queryKey: keys.tasks, queryFn: ({ signal }) => api.get<MyTasks>('/me/tasks', { signal }) });
}

export function useCreateBatch(teamId: string) {
  const api = useApi();
  return useGuardedMutation<{ title: string; description: string; propose: boolean }, Batch>({
    mutationFn: (body) => api.post<Batch>(`/teams/${teamId}/batches`, body),
  });
}

const useBatchCall = <TVars>(batchId: string, call: (api: ReturnType<typeof useApi>, vars: TVars, headers: Record<string, string>) => Promise<Batch>) =>
  useVersionedMutation<TVars, Batch>(keys.batch(batchId), (api, vars, version) => call(api, vars, ifMatchHeader(version)));

export const useTransition = (batchId: string) =>
  useBatchCall<{ action: BatchAction; reason?: string; deadline?: string; purchaseOutside?: boolean }>(batchId, (api, body, headers) =>
    api.post<Batch>(`/batches/${batchId}/transitions`, body, { headers }),
  );

export const usePatchBatch = (batchId: string) =>
  useBatchCall<PatchBatchRequest>(batchId, (api, body, headers) => api.patch<Batch>(`/batches/${batchId}`, body, { headers }));

export const useSetAssignments = (batchId: string) =>
  useBatchCall<AssignmentsRequest>(batchId, (api, body, headers) =>
    api.put<Batch>(`/batches/${batchId}/assignments`, body, { headers }),
  );

export function useAddItem(batchId: string) {
  const api = useApi();
  return useGuardedMutation<ItemRequest, Item>({
    mutationFn: (body) => api.post<Item>(`/batches/${batchId}/items`, body),
  });
}

export function usePutItem() {
  const api = useApi();
  return useGuardedMutation<{ item: Item; body: ItemRequest }, Item>({
    mutationFn: ({ item, body }) => api.put<Item>(`/items/${item.id}`, body, { headers: ifMatchHeader(item.version) }),
  });
}

type ItemAction = 'withdraw' | 'resubmit' | 'force-reject' | 'unpurchasable' | 'unpurchasable/undo' | 'review/undo';
const REASON_ACTIONS: ItemAction[] = ['force-reject', 'unpurchasable', 'unpurchasable/undo', 'review/undo'];

export function useItemAction() {
  const api = useApi();
  return useGuardedMutation<{ item: Pick<Item, 'id' | 'version'>; action: ItemAction; reason?: string }, Item>({
    mutationFn: ({ item, action, reason }) =>
      api.post<Item>(`/items/${item.id}/${action}`, REASON_ACTIONS.includes(action) ? { reason } : undefined, { headers: ifMatchHeader(item.version) }),
  });
}

/** POST /batches/{id}/reviews: decisions on items (each carries its own version), no If-Match on the batch. */
export const useReview = (batchId: string) =>
  useVersionedMutation<ReviewRequest, Batch>(keys.batch(batchId), async (api, body) => (await api.post<ReviewResult>(`/batches/${batchId}/reviews`, body)).batch);

