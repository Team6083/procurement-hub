import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { tasksKey } from './batches';
import { useApi } from './context';
import type { Candidate, Delivery, DeliveryLine, DeliveryLineRequest, DeliverySummary, MatchRequest, Page, Problem, ProblemAction, VendorOrderLine } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { linesToCloseKey, ordersKey } from './vendorOrders';
import { ifMatchHeader } from './versioned';

export const deliveriesKey = ['deliveries'] as const;
export const deliveryKey = (id: string | undefined) => ['delivery', id] as const;
export const pendingLinesKey = ['delivery-lines', 'pending'] as const;
export const problemsKey = ['problems'] as const;
const suggestionsKey = (lineId: string) => ['delivery-line', lineId, 'suggestions'] as const;

/** Everything a receiving write can change: lists, the worklists, tasks, vendor orders and batch progress. */
const touched = [deliveriesKey, pendingLinesKey, problemsKey, tasksKey, ordersKey, ['vendor-order'], linesToCloseKey, ['batch'], ['delivery-line']];

export interface DeliveryFilters {
  voided?: 'true' | 'false';
  from?: string;
  to?: string;
  q?: string;
}

/** GET /deliveries with cursor pagination, newest first. */
export function useDeliveryList(filters: DeliveryFilters) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...deliveriesKey, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<DeliverySummary>>('/deliveries', {
        query: { voided: filters.voided, from: filters.from || undefined, to: filters.to || undefined, q: filters.q?.trim() || undefined, cursor: pageParam, limit: 25 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** GET /deliveries/{id}; `version` is the If-Match value for every write on the delivery and its lines. */
export function useDelivery(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: deliveryKey(id),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<Delivery>(`/deliveries/${id}`, { signal }),
  });
}

/** GET /delivery-lines: the matching worklist (unmatched and partial lines). */
export function usePendingLines(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: pendingLinesKey,
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: DeliveryLine[] }>('/delivery-lines', { query: { matchState: 'unmatched,partial' }, signal })).items,
  });
}

/** GET /problems?status=… (not voided). */
export function useProblems(status: 'open' | 'resolved', enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...problemsKey, status],
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: Problem[] }>('/problems', { query: { status }, signal })).items,
  });
}

/** GET /vendor-order-lines?toClose=true: short lines without open problems, waiting for a close decision. */
export function useLinesToClose(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: linesToCloseKey,
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: VendorOrderLine[] }>('/vendor-order-lines', { query: { toClose: true }, signal })).items,
  });
}

/** GET /purchasing/match-candidates for a box line that is not saved yet; runs once the SKU or name has 2+ characters. */
export function useMatchCandidates(sku: string, name: string) {
  const api = useApi();
  const s = sku.trim();
  const n = name.trim();
  return useQuery({
    queryKey: ['purchasing', 'match-candidates', s, n],
    enabled: s.length >= 2 || n.length >= 2,
    queryFn: async ({ signal }) =>
      (await api.get<{ items: Candidate[] }>('/purchasing/match-candidates', { query: { sku: s || undefined, name: n || undefined }, signal })).items,
  });
}

/** GET /delivery-lines/{id}/suggestions: candidates with the system's suggested split of the unmatched rest. */
export function useSuggestions(lineId: string) {
  const api = useApi();
  return useQuery({
    queryKey: suggestionsKey(lineId),
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ signal }) => (await api.get<{ items: Candidate[] }>(`/delivery-lines/${lineId}/suggestions`, { signal })).items,
  });
}

export interface NewDelivery {
  receivedAt?: string;
  source: string;
  note: string;
  lines: DeliveryLineRequest[];
}

/** POST /deliveries: one box with its lines and any matches made on the spot. */
export function useCreateDelivery() {
  const api = useApi();
  return useGuardedMutation<NewDelivery, Delivery>({
    mutationFn: (body) => api.post<Delivery>('/deliveries', body),
    invalidate: touched,
  });
}

// Writes on one delivery go one after another, each with the version the previous one produced.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(key, next);
  return next;
}

/**
 * A write on a delivery or one of its lines: If-Match is the delivery version in the cache when the write runs, and
 * the returned delivery replaces the cache before the next queued write starts. A conflict refetches.
 */
function useDeliveryMutation<TVars>(deliveryId: string, call: (api: ApiClient, vars: TVars, version: number | undefined) => Promise<Delivery>) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, Delivery>({
    mutationFn: (vars) =>
      serial(deliveryId, async () => {
        const d = await call(api, vars, qc.getQueryData<Delivery>(deliveryKey(deliveryId))?.version);
        qc.setQueryData(deliveryKey(deliveryId), d);
        return d;
      }),
    invalidate: touched,
    conflictKeys: [deliveryKey(deliveryId)],
  });
}

/**
 * PUT /delivery-lines/{id}/matches. With `markRest`, the rest of the line is then marked as needing no match with
 * that reason (the over-delivery shortcut), using the version the first write returned.
 */
export const useSetMatches = (deliveryId: string) =>
  useDeliveryMutation<{ lineId: string; matches: MatchRequest[]; markRest?: string }>(deliveryId, async (api, { lineId, matches, markRest }, version) => {
    const d = await api.put<Delivery>(`/delivery-lines/${lineId}/matches`, { matches }, { headers: ifMatchHeader(version) });
    const line = d.lines.find((l) => l.id === lineId);
    if (!markRest || !line || (line.matchState !== 'unmatched' && line.matchState !== 'partial')) return d;
    return api.post<Delivery>(`/delivery-lines/${lineId}/no-match`, { reason: markRest }, { headers: ifMatchHeader(d.version) });
  });

/** POST /delivery-lines/{id}/no-match or …/no-match/undo, both with a reason. */
export const useNoMatch = (deliveryId: string) =>
  useDeliveryMutation<{ lineId: string; undo: boolean; reason: string }>(deliveryId, (api, { lineId, undo, reason }, version) =>
    api.post<Delivery>(`/delivery-lines/${lineId}/no-match${undo ? '/undo' : ''}`, { reason }, { headers: ifMatchHeader(version) }),
  );

/** POST /deliveries/{id}/void with a reason (409 blocked_by_dependency lists what to undo first). */
export const useVoidDelivery = (deliveryId: string) =>
  useDeliveryMutation<{ reason: string }>(deliveryId, (api, { reason }, version) =>
    api.post<Delivery>(`/deliveries/${deliveryId}/void`, { reason }, { headers: ifMatchHeader(version) }),
  );

/** POST /problems/{id}/resolve with the problem's own version in If-Match. */
export function useResolveProblem() {
  const api = useApi();
  return useGuardedMutation<{ problem: Problem; action: ProblemAction; refundBase: string | null; note: string }, Problem>({
    mutationFn: ({ problem, ...body }) => api.post<Problem>(`/problems/${problem.id}/resolve`, body, { headers: ifMatchHeader(problem.version) }),
    invalidate: touched,
  });
}

/** POST /problems/{id}/unresolve: undo a resolution; its refund entry is voided. */
export function useUnresolveProblem() {
  const api = useApi();
  return useGuardedMutation<{ problem: Problem; reason: string }, Problem>({
    mutationFn: ({ problem, reason }) => api.post<Problem>(`/problems/${problem.id}/unresolve`, { reason }, { headers: ifMatchHeader(problem.version) }),
    invalidate: touched,
  });
}
