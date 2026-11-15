import { useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { auditKey, batchKey, batchQuery, batchesKey, itemsKey, tasksKey } from './batches';
import { useApi } from './context';
import type {
  AdjustmentRequest, AdjustmentResult, CreateOrderRequest, Item, CreateVendorTransactionRequest, Order, PatchOrderRequest,
  PatchVendorTransactionRequest, VendorTransactionView,
} from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, type Versioned } from './versioned';

export const ordersKey = (batchId: string | undefined) => ['batch', batchId, 'orders'] as const;
export const vendorTransactionKey = (id: string | undefined) => ['vendor-transaction', id] as const;

/** GET /batches/{id}/orders: all orders by number, cancelled ones included, not paginated. */
export function useOrders(batchId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ordersKey(batchId),
    enabled: !!batchId,
    queryFn: async ({ signal }) => (await api.get<{ items: Order[] }>(`/batches/${batchId}/orders`, { signal })).items,
  });
}

/** Everything an order change can touch on the batch page. */
const orderChanged = (batchId: string): QueryKey[] => [ordersKey(batchId), itemsKey(batchId), batchKey(batchId), batchesKey, tasksKey, auditKey(batchId)];

export function useCreateOrder(batchId: string) {
  const api = useApi();
  return useGuardedMutation<CreateOrderRequest, Order>({
    mutationFn: (body) => api.post<Order>(`/batches/${batchId}/orders`, body),
    invalidate: orderChanged(batchId),
  });
}

export function usePatchOrder(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ order: Order; body: PatchOrderRequest }, Order>({
    mutationFn: ({ order, body }) => api.patch<Order>(`/orders/${order.id}`, body, { headers: ifMatchHeader(order.version) }),
    invalidate: orderChanged(batchId),
  });
}

export function useCancelOrder(batchId: string) {
  const api = useApi();
  return useGuardedMutation<Order, Order>({
    mutationFn: (order) => api.delete<Order>(`/orders/${order.id}`, { headers: ifMatchHeader(order.version) }),
    invalidate: orderChanged(batchId),
  });
}

export function useAddAdjustment(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ order: Order; body: AdjustmentRequest }, AdjustmentResult>({
    mutationFn: ({ order, body }) => api.post<AdjustmentResult>(`/orders/${order.id}/adjustments`, body, { headers: ifMatchHeader(order.version) }),
    invalidate: orderChanged(batchId),
  });
}

export function useCreateVendorTransaction() {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<CreateVendorTransactionRequest, VendorTransactionView>({
    mutationFn: (body) => api.post<VendorTransactionView>('/vendor-transactions', body),
    onSuccess: (v) => {
      for (const batchId of v.batchIds) void qc.invalidateQueries({ queryKey: ordersKey(batchId) });
    },
  });
}

export function useVendorTransaction(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: vendorTransactionKey(id),
    enabled: !!id,
    queryFn: async ({ signal }): Promise<Versioned<VendorTransactionView>> => {
      const r = await api.full.get<VendorTransactionView>(`/vendor-transactions/${id}`, { signal });
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
  });
}

type VtCall = (api: ReturnType<typeof useApi>, headers: Record<string, string>) => Promise<{ data: VendorTransactionView; etag: number | undefined }>;

/** Versioned write on an external order: If-Match from the cached ETag, response replaces the cache, conflict refetches. */
function useVtCall<TVars>(id: string, call: (vars: TVars) => VtCall) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, Versioned<VendorTransactionView>>({
    mutationFn: async (vars) => {
      const cached = qc.getQueryData<Versioned<VendorTransactionView>>(vendorTransactionKey(id));
      const r = await call(vars)(api, ifMatchHeader(cached?.etag));
      return { data: r.data, etag: r.etag ?? r.data.version };
    },
    conflictKeys: [vendorTransactionKey(id)],
    onSuccess: (v) => {
      qc.setQueryData(vendorTransactionKey(id), v);
      // Costs, order and item states changed on every involved batch.
      const stale: QueryKey[] = [batchesKey, tasksKey];
      for (const batchId of v.data.batchIds) stale.push(...orderChanged(batchId));
      for (const queryKey of stale) void qc.invalidateQueries({ queryKey });
    },
  });
}

export const usePatchVendorTransaction = (id: string) =>
  useVtCall<PatchVendorTransactionRequest>(id, (body) => (api, headers) =>
    api.full.patch<VendorTransactionView>(`/vendor-transactions/${id}`, body, { headers }),
  );

export const useVendorTransactionAction = (id: string) =>
  useVtCall<'place' | 'cancel'>(id, (action) => (api, headers) =>
    api.full.post<VendorTransactionView>(`/vendor-transactions/${id}/${action}`, undefined, { headers }),
  );

/** The batches an external order spans (shares the cache with useBatch). */
export function useBatchesById(ids: string[]) {
  const api = useApi();
  return useQueries({ queries: ids.map((id) => batchQuery(api, id)) });
}

/** Orders of several batches (shares the cache with useOrders). */
export function useOrdersOf(batchIds: string[]) {
  const api = useApi();
  return useQueries({
    queries: batchIds.map((id) => ({
      queryKey: ordersKey(id),
      queryFn: async ({ signal }: { signal: AbortSignal }) => (await api.get<{ items: Order[] }>(`/batches/${id}/orders`, { signal })).items,
    })),
  });
}

/** Items of several batches (shares the cache with useItems). */
export function useItemsOf(batchIds: string[]) {
  const api = useApi();
  return useQueries({
    queries: batchIds.map((id) => ({
      queryKey: itemsKey(id),
      queryFn: async ({ signal }: { signal: AbortSignal }) => (await api.get<{ items: Item[] }>(`/batches/${id}/items`, { signal })).items,
    })),
  });
}
