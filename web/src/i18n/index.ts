import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
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

export const SUPPORTED_LANGUAGES = ['en', 'zh-TW'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
const STORAGE_KEY = 'ph.lang';

function isLanguage(v: unknown): v is Language {
  return SUPPORTED_LANGUAGES.includes(v as Language);
}

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

/** True when the user has already chosen a language on this device. */
export function hasStoredLanguage(): boolean {
  try {
    return isLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export const resources = {
  en: { common: enCommon, errors: enErrors, auth: enAuth, teams: enTeams, admin: enAdmin, batches: enBatches },
  'zh-TW': { common: zhCommon, errors: zhErrors, auth: zhAuth, teams: zhTeams, admin: zhAdmin, batches: zhBatches },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'errors', 'auth', 'teams', 'admin', 'batches'],
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  void i18n.changeLanguage(lang);
}

export default i18n;
