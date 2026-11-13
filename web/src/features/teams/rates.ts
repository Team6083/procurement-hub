/** Currencies a team may set a rate for: supported minus the base currency. */
export function selectableCurrencies(supported: string[], base: string): string[] {
  return supported.filter((c) => c !== base);
}
