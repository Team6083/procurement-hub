import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context';
import { orderChanged, ordersKey } from '../../api/orders';
import type { Order, VendorTransactionView } from '../../api/types';
import { useGuardedMutation } from '../../api/useGuardedMutation';
import { runExternalOrder, type RunExternalOrder } from './placeOrders';

/** Creates the team orders of several batches, then one external order over them (see runExternalOrder); not atomic. */
export function usePlaceExternalOrder() {
  const api = useApi();
  const qc = useQueryClient();
  return useGuardedMutation<Omit<RunExternalOrder, 'createOrder' | 'createVendorTransaction'>, VendorTransactionView>({
    mutationFn: async (run) => {
      try {
        return await runExternalOrder({
          ...run,
          createOrder: (batchId, body) => api.post<Order>(`/batches/${batchId}/orders`, body),
          createVendorTransaction: (body) => api.post<VendorTransactionView>('/vendor-transactions', body),
        });
      } finally {
        // Also after a partial failure: the created draft orders must show up and their items leave the ready list.
        for (const batchId of new Set(run.plans.map((p) => p.batchId))) for (const queryKey of orderChanged(batchId)) void qc.invalidateQueries({ queryKey });
      }
    },
    onSuccess: (v) => {
      for (const batchId of v.batchIds) void qc.invalidateQueries({ queryKey: ordersKey(batchId) });
    },
  });
}
