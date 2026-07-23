import { I18nManager } from 'react-native';
import { initSecureStorage } from '@/store/secure-storage';
import { useAuthStore } from '@/store/auth.store';
import { useSettingsStore } from '@/store/settings.store';
import i18n from '@/i18n';

/**
 * One-time cold-start bootstrap:
 *  1. Bring up the ENCRYPTED MMKV (fetches the per-device key from the keystore).
 *  2. Rehydrate the persisted stores (deferred via skipHydration until now).
 *  3. Re-sync i18n + RTL to the restored language.
 *
 * Must complete before the UI renders — the root layout awaits it.
 */
export async function bootstrapApp(): Promise<void> {
  await initSecureStorage();

  await Promise.all([
    useAuthStore.persist.rehydrate(),
    useSettingsStore.persist.rehydrate(),
  ]);

  const lang = useSettingsStore.getState().language;
  if (i18n.language !== lang) {
    await i18n.changeLanguage(lang);
  }
  const isRtl = lang === 'ar';
  I18nManager.allowRTL(isRtl);
  I18nManager.forceRTL(isRtl);
}
