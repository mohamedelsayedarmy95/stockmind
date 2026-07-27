import { I18nManager } from 'react-native';
import { initSecureStorage } from '@/store/secure-storage';
import { initDatabase } from '@/db/database';
import { runEventBackfill } from '@/db/event-migration';
import { installGlobalCrashHandler, captureException } from '@/lib/crash-reporting';
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

  // Open the SQLCipher-encrypted local database (offline-first source of truth).
  await initDatabase();
  installGlobalCrashHandler();

  // Event-log backfill (docs/event-schema.md §8). Orchestrated here rather
  // than inside initDatabase: it's a business migration, and putting it in the
  // db module would make database.ts and event-migration.ts import each other.
  //
  // It is built to fail safe — a mismatch aborts the transaction and changes
  // nothing — so a failure must not stop the app booting on existing data.
  try {
    const outcome = await runEventBackfill();
    if (outcome.status === 'migrated' && outcome.eventsWritten > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[events] backfilled ${outcome.eventsWritten} events ` +
          `(${outcome.openingBalances} opening balances), ` +
          `${outcome.pairsVerified} balances verified`,
      );
    }
  } catch (e) {
    await captureException(e);
  }

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
