// Language selection rules (spec section 0): the browser's preferences pick the initial
// language (zh* -> zh-TW, en* -> en, otherwise en); once the user has chosen a language and it
// is saved to /me, that choice wins on every device.

export const SUPPORTED_LANGUAGES = ['en', 'zh-TW'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(v: unknown): v is Language {
  return SUPPORTED_LANGUAGES.includes(v as Language);
}

/** The first browser preference we support, in the browser's order; else `en`. */
export function detectLanguage(preferences: readonly string[] | undefined): Language {
  for (const pref of preferences ?? []) {
    const tag = pref.trim().toLowerCase();
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-TW';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return DEFAULT_LANGUAGE;
}

/** Language to start with: an explicit choice remembered by this browser, else detection. */
export function initialLanguage(stored: unknown, preferences: readonly string[] | undefined): Language {
  return isLanguage(stored) ? stored : detectLanguage(preferences);
}

/**
 * Whether the /me locale should override the current language. The server stores `en` until the
 * user picks something, so `en` alone cannot be told apart from "never chosen": it is adopted
 * only once this browser has seen an explicit choice (made here, or adopted from /me before).
 * A non-default locale can only come from a choice and always wins.
 */
export function profileLanguage(meLocale: unknown, browserHasChoice: boolean): Language | null {
  if (!isLanguage(meLocale)) return null;
  if (meLocale !== DEFAULT_LANGUAGE || browserHasChoice) return meLocale;
  return null;
}
