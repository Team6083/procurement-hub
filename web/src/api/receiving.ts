import { useQuery, type QueryKey } from '@tanstack/react-query';
import { auditKey, batchKey, batchesKey, itemsKey, tasksKey } from './batches';
import { useApi } from './context';
import { ordersKey } from './orders';
import type {
  ExceptionRequest, ExceptionResult, ItemException, Item, Receipt, ReceiptRequest, ReceiptResult, ResolveExceptionRequest,
} from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export const receiptsKey = (itemId: string | undefined) => ['item', itemId, 'receipts'] as const;
export const exceptionsKey = (itemId: string | undefined) => ['item', itemId, 'exceptions'] as const;

/** GET /items/{id}/receipts: oldest first, not paginated. */
export function useItemReceipts(itemId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: receiptsKey(itemId),
    enabled: !!itemId && enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: Receipt[] }>(`/items/${itemId}/receipts`, { signal })).items,
  });
}

/** GET /items/{id}/exceptions: oldest first, resolved ones included. */
export function useItemExceptions(itemId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: exceptionsKey(itemId),
    enabled: !!itemId && enabled,
    queryFn: async ({ signal }) => (await api.get<{ items: ItemException[] }>(`/items/${itemId}/exceptions`, { signal })).items,
  });
}

/** Everything a receiving change can touch on the batch page (a refund also changes the order). */
const receivingChanged = (batchId: string, itemId: string): QueryKey[] => [
  itemsKey(batchId), batchKey(batchId), batchesKey, tasksKey, auditKey(batchId), ordersKey(batchId), receiptsKey(itemId), exceptionsKey(itemId),
];

export function useRecordReceipt(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ item: Item; body: ReceiptRequest }, ReceiptResult>({
    mutationFn: ({ item, body }) => api.post<ReceiptResult>(`/items/${item.id}/receipts`, body, { headers: ifMatchHeader(item.version) }),
    invalidate: [itemsKey(batchId), batchKey(batchId), batchesKey, tasksKey, auditKey(batchId), ['item']],
  });
}

export function useReportException(batchId: string) {
  const api = useApi();
  return useGuardedMutation<{ item: Item; body: ExceptionRequest }, ExceptionResult>({
    mutationFn: ({ item, body }) => api.post<ExceptionResult>(`/items/${item.id}/exceptions`, body, { headers: ifMatchHeader(item.version) }),
    invalidate: [itemsKey(batchId), batchKey(batchId), batchesKey, tasksKey, auditKey(batchId), ['item']],
  });
}

export function useResolveException(batchId: string, itemId: string) {
  const api = useApi();
  return useGuardedMutation<{ exception: ItemException; body: ResolveExceptionRequest }, ExceptionResult>({
    mutationFn: ({ exception, body }) => api.post<ExceptionResult>(`/exceptions/${exception.id}/resolve`, body, { headers: ifMatchHeader(exception.version) }),
    invalidate: receivingChanged(batchId, itemId),
  });
}
