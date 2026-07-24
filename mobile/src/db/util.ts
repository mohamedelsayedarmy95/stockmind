import * as Crypto from 'expo-crypto';

/** UUID v4, same id space as the server so rows sync cleanly later. */
export function newId(): string {
  return Crypto.randomUUID();
}

/** Epoch millis — the unit stored in every created_at/updated_at column. */
export function now(): number {
  return Date.now();
}
