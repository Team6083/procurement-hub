import { useEffect } from 'react';
import { useMe } from '../api/me';
import { hasStoredLanguage, setLanguage } from '../i18n';

/** Adopts the server-side locale on a device where no language was chosen yet. */
export function LocaleSync() {
  const { me } = useMe();
  const locale = me?.locale;
  useEffect(() => {
    if (locale && !hasStoredLanguage()) setLanguage(locale);
  }, [locale]);
  return null;
}
