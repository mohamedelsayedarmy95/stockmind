import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/**
 * SQLCipher key management for the local database.
 *
 * The encrypted SQLite (SQLCipher) file is protected by a 256-bit key that is
 * UNIQUE PER DEVICE + INSTALL and never stored inside the database file or the
 * JS bundle. It lives only in the platform keystore (Android Keystore / iOS
 * Keychain) via expo-secure-store — hardware-backed where available. A copy of
 * the on-disk .db file is therefore useless without this device's key.
 *
 * Mirrors the MMKV key strategy in store/secure-storage.ts, with its own alias
 * so the two keys are independent.
 */

const DB_KEY_ALIAS = 'stockmind.sqlcipher.key';

export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_ALIAS);
  if (existing) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(DB_KEY_ALIAS, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}
