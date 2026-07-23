import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import en from './locales/en.json';
import ar from './locales/ar.json';
import { useSettingsStore, AppLanguage } from '@/store/settings.store';

/** Detect device language on first launch; fall back to persisted choice. */
function resolveInitialLanguage(): AppLanguage {
  const persisted = useSettingsStore.getState().language;
  if (persisted) return persisted;
  const device = Localization.getLocales()[0]?.languageCode;
  return device === 'ar' ? 'ar' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

/** Switch language instantly (no app restart) and sync the store. */
export function changeLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  useSettingsStore.getState().setLanguage(lang);
}

export default i18n;
