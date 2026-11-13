import { useCallback } from 'react';
import { usePatchMe } from '../api/me';
import { setLanguage, type Language } from './index';

/** Switches the UI language immediately and persists it to PATCH /me (with If-Match). */
export function useChangeLanguage() {
  const patch = usePatchMe();
  const { mutate } = patch;
  const change = useCallback(
    (lang: Language) => {
      setLanguage(lang);
      mutate({ locale: lang });
    },
    [mutate],
  );
  return { change, mutation: patch };
}
