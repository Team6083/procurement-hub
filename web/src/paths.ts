/** URL builders for dynamic routes; segments are encoded so any slug or id stays one segment. */
export const paths = {
  purchasing: '/purchasing',
  vendorOrders: '/vendor-orders',
  admin: '/admin',
  adminVendors: '/admin/vendors',
  referenceRates: '/admin/reference-rates',
  roleMappings: '/admin/role-mappings',
  receiving: '/receiving',
  deliveries: '/deliveries',
  newDelivery: '/deliveries/new',
  delivery: (id: string) => `/deliveries/${encodeURIComponent(id)}`,
  team: (slug: string, tab = '') => `/teams/${encodeURIComponent(slug)}${tab && `/${tab}`}`,
  batch: (id: string) => `/batches/${encodeURIComponent(id)}`,
  vendorOrder: (id: string) => `/vendor-orders/${encodeURIComponent(id)}`,
};
