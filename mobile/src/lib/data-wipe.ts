import { wipeSecureStorage } from '@/store/secure-storage';
import { deleteDatabase, initDatabase } from '@/db/database';

/**
 * Destroys every locally persisted byte, then leaves the app in a usable
 * fresh-install state.
 *
 * MANUAL ONLY. Per UWOS Master Spec §4, no code path may call this
 * automatically — "لا حذف تلقائي كامل للبيانات في أي سيناريو". It runs solely
 * from an explicit, double-confirmed admin action in Settings. Failed unlock
 * attempts trigger an escalating lockout instead (see lib/biometric-guard).
 *
 * There are TWO encrypted stores on device and a wipe has to hit both:
 *   - MMKV  — tokens, session, settings
 *   - SQLCipher SQLite — every product, warehouse, movement, note, reminder
 *
 * Clearing only MMKV would leave the entire inventory readable on disk, since
 * the offline-first migration moved all business data into SQLite.
 *
 * The database is re-opened empty afterwards because the app keeps running:
 * the user is dropped back at onboarding, and that flow writes immediately.
 */
export async function wipeAllUserData(): Promise<void> {
  wipeSecureStorage();
  deleteDatabase();
  await initDatabase();
}
