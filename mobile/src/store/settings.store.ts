import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { I18nManager } from 'react-native';
import { secureZustandStorage } from './secure-storage';

export type AppLanguage = 'en' | 'ar';
export type AppThemeMode = 'dark' | 'light' | 'system';
export type InventoryUnit = 'piece' | 'carton' | 'kg';
/**
 * offline — local SQLCipher DB is the only source of truth, no network.
 * online — talks to the cloud backend (deferred to the sync phase).
 */
export type OperationMode = 'offline' | 'online';

interface SettingsState {
  language: AppLanguage;
  themeMode: AppThemeMode;
  /** First-launch onboarding gates (persisted). */
  languageChosen: boolean;
  operationMode: OperationMode | null;
  /** Default unit suggested when adding a product (display-only for now). */
  defaultUnit: InventoryUnit;
  /** Whether local reminder notifications are allowed to be scheduled. */
  notificationsEnabled: boolean;
  /** First-run guided tour has been completed or dismissed. */
  helpSeen: boolean;
  setLanguage: (lang: AppLanguage) => void;
  setThemeMode: (mode: AppThemeMode) => void;
  /** Records the first-launch language choice (also flips languageChosen). */
  chooseLanguage: (lang: AppLanguage) => void;
  setOperationMode: (mode: OperationMode) => void;
  setDefaultUnit: (unit: InventoryUnit) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  markHelpSeen: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: 'en',
      themeMode: 'dark',
      languageChosen: false,
      operationMode: null,
      defaultUnit: 'piece',
      notificationsEnabled: true,
      helpSeen: false,
      setLanguage: (language) => {
        const isRtl = language === 'ar';
        // Keep the native layout direction in sync for correct RTL mirroring.
        I18nManager.allowRTL(isRtl);
        I18nManager.forceRTL(isRtl);
        set({ language });
      },
      setThemeMode: (themeMode) => set({ themeMode }),
      chooseLanguage: (language) => {
        get().setLanguage(language);
        set({ languageChosen: true });
      },
      setOperationMode: (operationMode) => set({ operationMode }),
      setDefaultUnit: (defaultUnit) => set({ defaultUnit }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      markHelpSeen: () => set({ helpSeen: true }),
    }),
    {
      name: 'stockmind-settings',
      storage: createJSONStorage(() => secureZustandStorage),
      skipHydration: true,
    },
  ),
);
