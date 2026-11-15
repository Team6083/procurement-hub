/** URL builders for dynamic routes; segments are encoded so any slug or id stays one segment. */
export const paths = {
  placeOrders: '/orders',
  team: (slug: string, tab = '') => `/teams/${encodeURIComponent(slug)}${tab && `/${tab}`}`,
  batch: (id: string) => `/batches/${encodeURIComponent(id)}`,
  vendorTransaction: (id: string) => `/vendor-transactions/${encodeURIComponent(id)}`,
};
