import { useEffect } from 'react';
import { useMe } from '../api/me';
import { setLanguage } from '../i18n';
import { profileLanguage } from '../i18n/detect';

/**
 * Adopts the language saved to /me (spec section 0). A null locale means the user never chose
 * one, so the browser-detected language stays.
 */
export function LocaleSync() {
  const { me } = useMe();
  const locale = me?.locale;
  useEffect(() => {
    const lang = profileLanguage(locale);
    if (lang) setLanguage(lang);
  }, [locale]);
  return null;
}
