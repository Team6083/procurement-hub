import type { MatchRequest } from '../../api/types';

export interface Slot {
  vendorOrderLineId: string;
  /** How many units the vendor order line can still take. */
  capacity: number;
}

/**
 * Splits a box line over the chosen vendor order lines in order, good units first, never past a line's capacity
 * (the server's suggestion rule, spec 10.4). What does not fit is returned as `left` and stays pending.
 */
export function allocate(slots: Slot[], good: number, problem: number): { matches: MatchRequest[]; left: number } {
  const matches: MatchRequest[] = [];
  for (const s of slots) {
    const g = Math.min(Math.max(s.capacity, 0), good);
    const p = Math.min(Math.max(s.capacity, 0) - g, problem);
    good -= g;
    problem -= p;
    if (g + p > 0) matches.push({ vendorOrderLineId: s.vendorOrderLineId, goodQuantity: g, problemQuantity: p });
  }
  return { matches, left: good + problem };
}

/** A quantity input's value as a whole number of at least 0, or null when it is not one. */
export function parseCount(v: string): number | null {
  const s = v.trim();
  if (s === '') return 0;
  return /^\d+$/.test(s) ? Number(s) : null;
}
