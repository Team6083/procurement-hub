import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectLanguage, type Language } from './detect';
import enAuth from './locales/en/auth.json';
import enAdmin from './locales/en/admin.json';
import enBatches from './locales/en/batches.json';
import enCommon from './locales/en/common.json';
import enPurchasing from './locales/en/purchasing.json';
import enErrors from './locales/en/errors.json';
import enTeams from './locales/en/teams.json';
import zhAdmin from './locales/zh-TW/admin.json';
import zhBatches from './locales/zh-TW/batches.json';
import zhAuth from './locales/zh-TW/auth.json';
import zhCommon from './locales/zh-TW/common.json';
import zhPurchasing from './locales/zh-TW/purchasing.json';
import zhErrors from './locales/zh-TW/errors.json';
import zhTeams from './locales/zh-TW/teams.json';

export { SUPPORTED_LANGUAGES, type Language } from './detect';

export const resources = {
  en: { common: enCommon, errors: enErrors, auth: enAuth, teams: enTeams, admin: enAdmin, batches: enBatches, purchasing: enPurchasing },
  'zh-TW': { common: zhCommon, errors: zhErrors, auth: zhAuth, teams: zhTeams, admin: zhAdmin, batches: zhBatches, purchasing: zhPurchasing },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  // The browser picks the language until /me says the user chose one (LocaleSync).
  lng: detectLanguage(typeof navigator === 'undefined' ? undefined : navigator.languages),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'errors', 'auth', 'teams', 'admin', 'batches', 'purchasing'],
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
}

/** Switches the UI language. Saving the choice is PATCH /me's job (useChangeLanguage). */
export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
}

export default i18n;
