// Browser APIs that jsdom lacks but Chakra UI / Ark UI (zag.js) use.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  window.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  // zag.js (combobox, dialog focus trap) calls CSS.escape, which jsdom lacks.
  const css = (window.CSS ?? {}) as { escape?: (s: string) => string };
  css.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, (c) => `\\${c}`);
  if (!window.CSS) Object.defineProperty(window, 'CSS', { value: css, configurable: true });
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.scrollTo ??= function scrollTo() {};
}
