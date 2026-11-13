import { useEffect } from 'react';
import { useMe } from '../api/me';
import { hasStoredLanguage, setLanguage } from '../i18n';
import { profileLanguage } from '../i18n/detect';

/** Adopts the language saved to /me once it reflects a user choice (spec section 0). */
export function LocaleSync() {
  const { me } = useMe();
  const locale = me?.locale;
  useEffect(() => {
    const lang = profileLanguage(locale, hasStoredLanguage());
    // Also remembers it as a choice in this browser, so a later `en` from /me is adopted too.
    if (lang) setLanguage(lang);
  }, [locale]);
  return null;
}
