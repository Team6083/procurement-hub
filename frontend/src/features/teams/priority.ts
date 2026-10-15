export const PRIORITIES = ['5', '4', '3', '2', '1'] as const;
export type PriorityKey = (typeof PRIORITIES)[number];

/** Team label if set (non-blank), else the translated built-in default label. */
export function priorityLabel(
  labels: Record<string, string> | null | undefined,
  key: PriorityKey,
  defaultLabel: (key: PriorityKey) => string,
): string {
  const custom = labels?.[key]?.trim();
  return custom ? custom : defaultLabel(key);
}

/** Drops blank labels so the default label applies; used to build the PATCH body. */
export function cleanPriorityLabels(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PRIORITIES) {
    const v = (input[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}
