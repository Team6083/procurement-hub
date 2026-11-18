import type { Item } from '../../api/types';

/** Pseudo status for the filter: approved items with quantity still to purchase. */
export const TO_PURCHASE = 'to_purchase';

export interface ItemFilters {
  subgroup?: string;
  requester?: string;
  priority?: string;
  /** One status or several (match any); empty means all. */
  status?: string | string[];
  vendor?: string;
}

/** Exact-match filters; empty/undefined values are ignored. */
const matchesStatus = (i: Pick<Item, 'status' | 'toPurchaseQuantity'>, s: string) => (s === TO_PURCHASE ? i.status === 'approved' && i.toPurchaseQuantity > 0 : i.status === s);

export function filterItems<T extends Pick<Item, 'subgroupId' | 'requesterId' | 'priority' | 'status' | 'vendorName' | 'toPurchaseQuantity'>>(items: T[], f: ItemFilters): T[] {
  const statuses = ([] as (string | undefined)[]).concat(f.status).filter(Boolean) as string[];
  return items.filter(
    (i) =>
      (!f.subgroup || i.subgroupId === f.subgroup) &&
      (!f.requester || i.requesterId === f.requester) &&
      (!f.priority || String(i.priority) === f.priority) &&
      (statuses.length === 0 || statuses.some((s) => matchesStatus(i, s))) &&
      (!f.vendor || i.vendorName === f.vendor),
  );
}

/** Items that count toward estimates: not withdrawn or rejected. */
export const countsTowardEstimate = (i: Pick<Item, 'status'>) => i.status !== 'withdrawn' && i.status !== 'rejected';
