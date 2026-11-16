/** URL builders for dynamic routes; segments are encoded so any slug or id stays one segment. */
export const paths = {
  purchasing: '/purchasing',
  receiving: '/receiving',
  team: (slug: string, tab = '') => `/teams/${encodeURIComponent(slug)}${tab && `/${tab}`}`,
  batch: (id: string) => `/batches/${encodeURIComponent(id)}`,
  vendorOrder: (id: string) => `/vendor-orders/${encodeURIComponent(id)}`,
};
