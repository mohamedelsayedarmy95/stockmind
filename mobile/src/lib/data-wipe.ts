import { wipeSecureStorage } from '@/store/secure-storage';
import { deleteDatabase, initDatabase } from '@/db/database';

/**
 * Destroys every locally persisted byte, then leaves the app in a usable
 * fresh-install state.
 *
 * There are TWO encrypted stores on device and a wipe has to hit both:
 *   - MMKV  — tokens, session, settings
 *   - SQLCipher SQLite — every product, warehouse, movement, note, reminder
 *
 * Wiping only MMKV (what the tripwire used to do before the offline-first
 * migration moved all business data into SQLite) would leave the entire
 * inventory readable on disk — exactly the theft case the tripwire exists to
 * defend against.
 *
 * The database is re-opened empty afterwards because the app keeps running:
 * the user is dropped back at onboarding, and that flow writes immediately.
 */
export async function wipeAllUserData(): Promise<void> {
  wipeSecureStorage();
  deleteDatabase();
  await initDatabase();
}
