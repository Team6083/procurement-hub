import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { initialLanguage, isLanguage, type Language } from './detect';
import enAuth from './locales/en/auth.json';
import enAdmin from './locales/en/admin.json';
import enBatches from './locales/en/batches.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enTeams from './locales/en/teams.json';
import zhAdmin from './locales/zh-TW/admin.json';
import zhBatches from './locales/zh-TW/batches.json';
import zhAuth from './locales/zh-TW/auth.json';
import zhCommon from './locales/zh-TW/common.json';
import zhErrors from './locales/zh-TW/errors.json';
import zhTeams from './locales/zh-TW/teams.json';

export { SUPPORTED_LANGUAGES, type Language } from './detect';

// Remembers that the user (here or on another device, via /me) explicitly chose a language.
const STORAGE_KEY = 'ph.lang';

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable
  }
}

/** True when this browser has seen an explicit language choice. */
export function hasStoredLanguage(): boolean {
  return isLanguage(storedLanguage());
}

export const resources = {
  en: { common: enCommon, errors: enErrors, auth: enAuth, teams: enTeams, admin: enAdmin, batches: enBatches },
  'zh-TW': { common: zhCommon, errors: zhErrors, auth: zhAuth, teams: zhTeams, admin: zhAdmin, batches: zhBatches },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(storedLanguage(), typeof navigator === 'undefined' ? undefined : navigator.languages),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'errors', 'auth', 'teams', 'admin', 'batches'],
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
}

/** Switches the UI language and remembers it as an explicit choice. */
export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  void i18n.changeLanguage(lang);
}

export default i18n;
