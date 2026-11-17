/**
 * Every query key in the app. Refetching after writes is global (see queryClient.ts), so these exist only to name
 * the cache entries consistently: one prefix per resource, the record id next, then sub-resources.
 */
export const keys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  tasks: ['tasks'] as const,
  teams: ['teams'] as const,
  team: (id: string | undefined) => ['team', id] as const,
  members: (teamId: string | undefined) => ['team', teamId, 'members'] as const,
  userSearch: (q: string) => ['users', 'search', q] as const,
  roleHolders: (role: string) => ['users', 'role', role] as const,
  batches: (filters: object) => ['batches', filters] as const,
  batch: (id: string | undefined) => ['batch', id] as const,
  items: (batchId: string | undefined) => ['batch', batchId, 'items'] as const,
  batchAudit: (batchId: string | undefined) => ['batch', batchId, 'audit'] as const,
  queue: ['purchasing', 'queue'] as const,
  matchCandidates: (sku: string, name: string) => ['purchasing', 'match-candidates', sku, name] as const,
  orders: (filters: object) => ['vendor-orders', filters] as const,
  order: (id: string | undefined) => ['vendor-order', id] as const,
  orderAudit: (id: string | undefined) => ['vendor-order', id, 'audit'] as const,
  linesToClose: ['vendor-order-lines', 'to-close'] as const,
  deliveries: (filters: object) => ['deliveries', filters] as const,
  delivery: (id: string | undefined) => ['delivery', id] as const,
  pendingLines: ['delivery-lines', 'pending'] as const,
  suggestions: (lineId: string) => ['delivery-line', lineId, 'suggestions'] as const,
  problems: (status: string) => ['problems', status] as const,
  vendors: (includeInactive: boolean) => ['vendors', includeInactive] as const,
  rates: ['reference-rates'] as const,
  roleMappings: ['role-mappings'] as const,
};

/** Audit timelines are fetched in pages of this size. */
export const AUDIT_PAGE_SIZE = 50;
