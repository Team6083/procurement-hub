import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { useApi } from './context';
import { AUDIT_PAGE_SIZE, keys } from './keys';
import type { AuditEvent, CostEntry, CostEntryBody, Page, QueueGroup, RefundBody, VendorOrder, VendorOrderLine, VendorOrderSummary } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader, serial, useVersionedMutation } from './versioned';

/** GET /purchasing/queue: approved items with quantity still to purchase, grouped by vendor. */
export function useQueue(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: keys.queue,
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: QueueGroup[] }>('/purchasing/queue', { signal })).items,
  });
}

export interface OrderFilters {
  status?: string;
  vendorId?: string;
  teamId?: string;
  /** `me`: only orders the caller owns. */
  ownerId?: string;
  q?: string;
}

/** GET /vendor-orders with cursor pagination. */
export function useVendorOrderList(filters: OrderFilters, enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.orders(filters),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<VendorOrderSummary>>('/vendor-orders', {
        query: { status: filters.status || undefined, vendorId: filters.vendorId || undefined, teamId: filters.teamId || undefined, ownerId: filters.ownerId || undefined, q: filters.q?.trim() || undefined, cursor: pageParam, limit: 25 },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** GET /vendor-orders/{id}; `version` in the body is the If-Match value for every write on the order. */
export function useVendorOrder(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: keys.order(id),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<VendorOrder>(`/vendor-orders/${id}`, { signal }),
  });
}

/** Order timeline (lines, cost entries and problems included), newest first. */
export function useOrderAudit(id: string | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.orderAudit(id),
    enabled: !!id,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<AuditEvent>>('/audit', { query: { objectType: 'vendor_order', objectId: id, order: 'desc', limit: AUDIT_PAGE_SIZE, cursor: pageParam }, signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** A write on a vendor order (or one of its lines or cost entries): If-Match is the cached order's version. */
const useOrderMutation = <TVars>(orderId: string, call: (api: ApiClient, vars: TVars, headers: Record<string, string>) => Promise<VendorOrder>) =>
  useVersionedMutation<TVars, VendorOrder>(keys.order(orderId), (api, vars, version) => call(api, vars, ifMatchHeader(version)));

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
  ownerIds: string[];
  externalOrderNo: string;
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

export const useCloseLine = (orderId: string) =>
  useOrderMutation<{ line: VendorOrderLine; type: 'short_accepted' | 'not_obtained'; reason: string; refund: RefundBody | null }>(orderId, (api, { line, ...body }, headers) =>
    api.post<VendorOrder>(`/vendor-order-lines/${line.id}/close`, body, { headers }),
  );

/** POST /vendor-orders/{id}/cost-entries: refunds and extra charges need a placed order. */
export const useCreateCostEntry = (orderId: string) =>
  useOrderMutation<CostEntryBody>(orderId, (api, body, headers) => api.post<VendorOrder>(`/vendor-orders/${orderId}/cost-entries`, body, { headers }));

/** PUT /cost-entries/{id}: replaces the entry (draft or placed). */
export const usePutCostEntry = (orderId: string) =>
  useOrderMutation<{ entry: CostEntry; body: CostEntryBody }>(orderId, (api, { entry, body }, headers) =>
    api.put<VendorOrder>(`/cost-entries/${entry.id}`, body, { headers }),
  );

/** DELETE /cost-entries/{id}: draft orders only. */
export const useDeleteCostEntry = (orderId: string) =>
  useOrderMutation<CostEntry>(orderId, (api, entry, headers) => api.delete<VendorOrder>(`/cost-entries/${entry.id}`, { headers }));

/** POST /cost-entries/{id}/void: placed orders; entries of a problem or closure are voided by undoing it (409). */
export const useVoidCostEntry = (orderId: string) =>
  useOrderMutation<{ entry: CostEntry; reason: string }>(orderId, (api, { entry, reason }, headers) =>
    api.post<VendorOrder>(`/cost-entries/${entry.id}/void`, { reason }, { headers }),
  );

export const useReopenLine = (orderId: string) =>
  useOrderMutation<{ line: VendorOrderLine; reason: string }>(orderId, (api, { line, reason }, headers) =>
    api.post<VendorOrder>(`/vendor-order-lines/${line.id}/reopen`, { reason }, { headers }),
  );

/** POST /vendor-orders: a draft for a vendor, with one line per item. */
export function useCreateOrder() {
  const api = useApi();
  return useGuardedMutation<{ vendorId: string; currency?: string; itemIds: string[]; ownerIds?: string[] }, VendorOrder>({
    mutationFn: (body) => api.post<VendorOrder>('/vendor-orders', body),
  });
}

/**
 * Adds items to an existing draft order, one line each. The first write takes the order's version from the summary
 * the user picked; each later one the version the previous write returned. Queued behind other writes on the order.
 */
export function useAddItemsToOrder() {
  const api = useApi();
  return useGuardedMutation<{ orderId: string; version: number; itemIds: string[] }, VendorOrder>({
    mutationFn: ({ orderId, version, itemIds }) =>
      serial(JSON.stringify(keys.order(orderId)), async () => {
        let cur: VendorOrder | undefined;
        let v = version;
        for (const itemId of itemIds) {
          cur = await api.post<VendorOrder>(`/vendor-orders/${orderId}/lines`, { itemId }, { headers: ifMatchHeader(v) });
          v = cur.version;
        }
        return cur as VendorOrder;
      }),
  });
}
