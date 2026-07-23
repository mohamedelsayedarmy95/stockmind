import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/**
 * Encrypted local storage.
 *
 * The MMKV database is encrypted with a 256-bit key that is UNIQUE PER DEVICE
 * and INSTALL. That key never lives inside the MMKV file or the JS bundle — it
 * is held in the platform keystore (iOS Keychain / Android Keystore) via
 * expo-secure-store, which is hardware-backed where available. An attacker with
 * a copy of the on-disk MMKV file therefore cannot read tokens or user data.
 *
 * Because fetching the key from the keystore is asynchronous, storage is
 * initialised once at cold start (see initSecureStorage) BEFORE any store
 * rehydrates. Consumers read the live instance through getStorage().
 */

const KEY_ALIAS = 'stockmind.mmkv.key';

let instance: MMKV | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ALIAS);
  if (existing) return existing;

  // 32 random bytes → hex, generated on-device, persisted only in the keystore.
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(KEY_ALIAS, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

/** Must be awaited once at app startup before stores rehydrate. */
export async function initSecureStorage(): Promise<void> {
  if (instance) return;
  const encryptionKey = await getOrCreateEncryptionKey();
  instance = new MMKV({ id: 'stockmind-secure', encryptionKey });
}

export function getStorage(): MMKV {
  if (!instance) {
    throw new Error('Secure storage used before initSecureStorage() completed');
  }
  return instance;
}

/**
 * Nuke every locally persisted byte. Used by the biometric auto-wipe tripwire
 * and on session termination.
 */
export function wipeAllLocalData(): void {
  instance?.clearAll();
}

/** Zustand persist adapter that always targets the live encrypted instance. */
export const secureZustandStorage = {
  getItem: (name: string): string | null => getStorage().getString(name) ?? null,
  setItem: (name: string, value: string): void => getStorage().set(name, value),
  removeItem: (name: string): void => getStorage().delete(name),
};
