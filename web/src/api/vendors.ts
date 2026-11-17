import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { keys } from './keys';
import type { Page, ReferenceRate, Vendor } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export interface VendorBody {
  name: string;
  aliases: string[];
  defaultCurrency: string;
  website: string;
  notes: string;
  active: boolean;
}

/** GET /vendors; the list is open to every signed-in user. */
export function useVendors(includeInactive = false) {
  const api = useApi();
  return useQuery({
    queryKey: keys.vendors(includeInactive),
    queryFn: async ({ signal }) => (await api.get<Page<Vendor>>('/vendors', { query: { includeInactive: includeInactive || undefined }, signal })).items,
  });
}

export function useCreateVendor() {
  const api = useApi();
  return useGuardedMutation<VendorBody, Vendor>({
    mutationFn: (body) => api.post<Vendor>('/vendors', body),
  });
}

export function usePutVendor() {
  const api = useApi();
  return useGuardedMutation<{ vendor: Vendor; body: VendorBody }, Vendor>({
    mutationFn: ({ vendor, body }) => api.put<Vendor>(`/vendors/${vendor.id}`, body, { headers: ifMatchHeader(vendor.version) }),
  });
}

/** GET /reference-rates: the global rates to the base currency, readable by everyone. */
export function useReferenceRates() {
  const api = useApi();
  return useQuery({
    queryKey: keys.rates,
    queryFn: async ({ signal }) => (await api.get<Page<ReferenceRate>>('/reference-rates', { signal })).items,
  });
}

/** PUT /reference-rates/{currency}: creates without If-Match, replaces with the rate's version. */
export function usePutRate() {
  const api = useApi();
  return useGuardedMutation<{ currency: string; rateToBase: string; existing?: ReferenceRate }, ReferenceRate>({
    mutationFn: ({ currency, rateToBase, existing }) =>
      api.put<ReferenceRate>(`/reference-rates/${currency}`, { rateToBase }, existing ? { headers: ifMatchHeader(existing.version) } : undefined),
  });
}

export function useDeleteRate() {
  const api = useApi();
  return useGuardedMutation<ReferenceRate, void>({
    mutationFn: (rate) => api.delete<void>(`/reference-rates/${rate.currency}`, { headers: ifMatchHeader(rate.version) }),
  });
}
