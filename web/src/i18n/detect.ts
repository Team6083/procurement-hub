// Language selection rules (spec section 0): the browser's preferences pick the initial
// language (zh* -> zh-TW, en* -> en, otherwise en); once the user has chosen a language and it
// is saved to /me (a non-null `locale`), that choice wins on every device.

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

/**
 * The language saved to /me, if the user ever chose one. `null` (never chosen) or anything
 * unknown leaves the browser-detected language in place.
 */
export function profileLanguage(meLocale: unknown): Language | null {
  return isLanguage(meLocale) ? meLocale : null;
}
