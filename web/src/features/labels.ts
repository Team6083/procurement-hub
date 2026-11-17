/** Record labels as users read them: vendor orders are `VO-12`, deliveries `DL-7`. The one place that knows the prefixes. */
export const orderLabel = (n: number | string) => `VO-${n}`;
export const deliveryLabel = (n: number | string) => `DL-${n}`;
