import type { Item } from '../../api/types';

/** Pseudo status for the filter: approved items with quantity still to purchase. */
export const TO_PURCHASE = 'to_purchase';

export interface ItemFilters {
  subgroup?: string;
  requester?: string;
  priority?: string;
  status?: string;
  vendor?: string;
}

/** Exact-match filters; empty/undefined values are ignored. */
export function filterItems<T extends Pick<Item, 'subgroupId' | 'requesterId' | 'priority' | 'status' | 'vendor' | 'toPurchaseQuantity'>>(items: T[], f: ItemFilters): T[] {
  return items.filter(
    (i) =>
      (!f.subgroup || i.subgroupId === f.subgroup) &&
      (!f.requester || i.requesterId === f.requester) &&
      (!f.priority || String(i.priority) === f.priority) &&
      (!f.status || (f.status === TO_PURCHASE ? i.status === 'approved' && i.toPurchaseQuantity > 0 : i.status === f.status)) &&
      (!f.vendor || i.vendor === f.vendor),
  );
}

/** Items that count toward estimates: not withdrawn or rejected. */
export const countsTowardEstimate = (i: Pick<Item, 'status'>) => i.status !== 'withdrawn' && i.status !== 'rejected';
