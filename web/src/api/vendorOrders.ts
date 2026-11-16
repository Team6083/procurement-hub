import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { tasksKey } from './batches';
import { useApi } from './context';
import type { AuditEvent, Item, Page, QueueGroup, VendorOrder, VendorOrderLine, VendorOrderSummary } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export const queueKey = ['purchasing', 'queue'] as const;
export const ordersKey = ['vendor-orders'] as const;
export const orderKey = (id: string | undefined) => ['vendor-order', id] as const;
export const orderAuditKey = (id: string | undefined) => ['vendor-order', id, 'audit'] as const;
export const linesToCloseKey = ['vendor-order-lines', 'toClose'] as const;

/** GET /purchasing/queue: approved items with quantity still to purchase, grouped by vendor. */
export function useQueue() {
  const api = useApi();
  return useQuery({
    queryKey: queueKey,
    queryFn: async ({ signal }) => (await api.get<{ items: QueueGroup[] }>('/purchasing/queue', { signal })).items,
  });
}

export interface OrderFilters {
  status?: string;
  vendorId?: string;
  teamId?: string;
  q?: string;
}

/** GET /vendor-orders with cursor pagination. */
export function useVendorOrderList(filters: OrderFilters, enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...ordersKey, filters],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<VendorOrderSummary>>('/vendor-orders', {
        query: { status: filters.status || undefined, vendorId: filters.vendorId || undefined, teamId: filters.teamId || undefined, q: filters.q?.trim() || undefined, cursor: pageParam, limit: 25 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** GET /vendor-orders/{id}; `version` in the body is the If-Match value for every write on the order. */
export function useVendorOrder(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: orderKey(id),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<VendorOrder>(`/vendor-orders/${id}`, { signal }),
  });
}

/** Order timeline (lines, ledger and problems included), oldest first. */
export function useOrderAudit(id: string | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: orderAuditKey(id),
    enabled: !!id,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<AuditEvent>>('/audit', { query: { objectType: 'vendor_order', objectId: id, limit: 50, cursor: pageParam }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// Writes on one order go one after another: each takes the version the previous one produced, so
// quickly editing several prices never races itself into a version conflict.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(key, next);
  return next;
}

const changed = (orderId: string) => [ordersKey, queueKey, tasksKey, orderAuditKey(orderId), linesToCloseKey, ['batch']];

/**
 * A write on a vendor order: If-Match is the order version in the cache at the moment the write runs,
 * the response (the whole order) replaces the cache, and a conflict refetches.
 */
export function useOrderMutation<TVars>(orderId: string, call: (api: ApiClient, vars: TVars, headers: Record<string, string>) => Promise<VendorOrder>) {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<TVars, VendorOrder>({
    mutationFn: (vars) =>
      serial(orderId, () => call(api, vars, ifMatchHeader(qc.getQueryData<VendorOrder>(orderKey(orderId))?.version))),
    invalidate: changed(orderId),
    conflictKeys: [orderKey(orderId)],
    onSuccess: (o) => qc.setQueryData(orderKey(orderId), o),
  });
}

export interface LineBody {
  teamId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string | null;
}

export const useAddLine = (orderId: string) =>
  useOrderMutation<{ itemId?: string } & Partial<LineBody>>(orderId, (api, body, headers) => api.post<VendorOrder>(`/vendor-orders/${orderId}/lines`, body, { headers }));

export const usePutLine = (orderId: string) =>
  useOrderMutation<{ line: VendorOrderLine; body: LineBody }>(orderId, (api, { line, body }, headers) =>
    api.put<VendorOrder>(`/vendor-order-lines/${line.id}`, body, { headers }),
  );

export const useDeleteLine = (orderId: string) =>
  useOrderMutation<VendorOrderLine>(orderId, (api, line, headers) => api.delete<VendorOrder>(`/vendor-order-lines/${line.id}`, { headers }));

export interface OrderBody {
  vendorId: string;
  currency: string;
  externalOrderNo: string;
  sharedCosts: { type: string; amount: string; note: string }[];
  teamCostOverrides: { teamId: string; amount: string }[] | null;
  overrideReason: string;
  chargedAmountBase: string | null;
  expectedDeliveryDate: string;
  paymentNote: string;
}

export const usePutOrder = (orderId: string) =>
  useOrderMutation<OrderBody>(orderId, (api, body, headers) => api.put<VendorOrder>(`/vendor-orders/${orderId}`, body, { headers }));

export type OrderAction = 'place' | 'unplace' | 'cancel' | 'uncancel';
export const useOrderAction = (orderId: string) =>
  useOrderMutation<{ action: OrderAction; reason?: string }>(orderId, (api, { action, reason }, headers) =>
    api.post<VendorOrder>(`/vendor-orders/${orderId}/${action}`, action === 'place' ? undefined : { reason }, { headers }),
  );

export const useAddLedger = (orderId: string) =>
  useOrderMutation<{ amountBase: string; vendorOrderLineId: string | null; reason: string }>(orderId, (api, body, headers) =>
    api.post<VendorOrder>(`/vendor-orders/${orderId}/ledger`, body, { headers }),
  );

export const useVoidLedger = (orderId: string) =>
  useOrderMutation<{ entryId: string; reason: string }>(orderId, (api, { entryId, reason }, headers) =>
    api.post<VendorOrder>(`/ledger-entries/${entryId}/void`, { reason }, { headers }),
  );

export const useCloseLine = (orderId: string) =>
  useOrderMutation<{ line: VendorOrderLine; type: 'short_accepted' | 'not_obtained'; reason: string; refundBase: string | null }>(orderId, (api, { line, ...body }, headers) =>
    api.post<VendorOrder>(`/vendor-order-lines/${line.id}/close`, body, { headers }),
  );

export const useReopenLine = (orderId: string) =>
  useOrderMutation<{ line: VendorOrderLine; reason: string }>(orderId, (api, { line, reason }, headers) =>
    api.post<VendorOrder>(`/vendor-order-lines/${line.id}/reopen`, { reason }, { headers }),
  );

/** POST /vendor-orders: a draft for a vendor, with one line per item. */
export function useCreateOrder() {
  const api = useApi();
  return useGuardedMutation<{ vendorId: string; currency?: string; itemIds: string[] }, VendorOrder>({
    mutationFn: (body) => api.post<VendorOrder>('/vendor-orders', body),
    invalidate: [ordersKey, queueKey, tasksKey, ['batch']],
  });
}

/** Adds items to an existing draft order, one line each (every write returns the next version). */
export function useAddItemsToOrder() {
  const api = useApi();
  return useGuardedMutation<{ orderId: string; version: number; itemIds: string[] }, VendorOrder>({
    mutationFn: async ({ orderId, version, itemIds }) => {
      let cur: VendorOrder | undefined;
      let v = version;
      for (const itemId of itemIds) {
        cur = await api.post<VendorOrder>(`/vendor-orders/${orderId}/lines`, { itemId }, { headers: ifMatchHeader(v) });
        v = cur.version;
      }
      return cur as VendorOrder;
    },
    invalidate: [ordersKey, queueKey, tasksKey, ['batch']],
    conflictKeys: [],
  });
}

/** POST /items/{id}/unpurchasable: "do not buy the remaining quantity" (or the whole item). */
export function useMarkUnpurchasable() {
  const api = useApi();
  return useGuardedMutation<{ item: Item; reason: string }, Item>({
    mutationFn: ({ item, reason }) => api.post<Item>(`/items/${item.id}/unpurchasable`, { reason }, { headers: ifMatchHeader(item.version) }),
    invalidate: [queueKey, tasksKey, ['batch']],
  });
}
