import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { I18nManager } from 'react-native';
import { secureZustandStorage } from './secure-storage';

export type AppLanguage = 'en' | 'ar';
export type AppThemeMode = 'dark' | 'light' | 'system';

interface SettingsState {
  language: AppLanguage;
  themeMode: AppThemeMode;
  setLanguage: (lang: AppLanguage) => void;
  setThemeMode: (mode: AppThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'en',
      themeMode: 'dark',
      setLanguage: (language) => {
        const isRtl = language === 'ar';
        // Keep the native layout direction in sync for correct RTL mirroring.
        I18nManager.allowRTL(isRtl);
        I18nManager.forceRTL(isRtl);
        set({ language });
      },
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    {
      name: 'stockmind-settings',
      storage: createJSONStorage(() => secureZustandStorage),
      skipHydration: true,
    },
  ),
);
