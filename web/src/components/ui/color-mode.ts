/**
 * Follows the operating system's light/dark preference (the app has no manual toggle) by
 * putting the "light" or "dark" class on <html>, which Chakra's _dark condition reads. Done in
 * script rather than with an inline <script> so the CSP (script-src 'self') is not affected.
 */
export function followSystemColorMode(root: HTMLElement = document.documentElement): () => void {
  const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const apply = () => {
    const mode = mql?.matches ? 'dark' : 'light';
    root.classList.remove(mode === 'dark' ? 'light' : 'dark');
    root.classList.add(mode);
    root.style.colorScheme = mode;
  };
  apply();
  mql?.addEventListener?.('change', apply);
  return () => mql?.removeEventListener?.('change', apply);
}
