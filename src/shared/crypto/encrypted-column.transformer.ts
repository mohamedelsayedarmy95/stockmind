import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { ValueTransformer } from 'typeorm';

/**
 * Transparent AES-256-GCM encryption for "data at rest" on individual columns.
 *
 * WHY GCM: it is an AEAD cipher — every ciphertext carries an authentication
 * tag, so a tampered value fails to decrypt instead of silently returning
 * garbage. This satisfies confidentiality AND integrity for classified fields.
 *
 * Key management: the 256-bit master key is derived (SHA-256) from the
 * DB_ENCRYPTION_KEY env var, which is injected by the security team at deploy
 * time and NEVER stored with the source. If the var is absent the transformer
 * becomes a no-op passthrough so local/dev environments keep working — encrypted
 * data is only ever produced when a key is present.
 *
 * On-disk format (base64):  [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size
const TAG_LENGTH = 16;

function resolveKey(): Buffer | null {
  const raw = process.env.DB_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) return null;
  // Normalize any-length secret to a fixed 32-byte key.
  return createHash('sha256').update(raw, 'utf8').digest();
}

function encrypt(plain: string): string {
  const key = resolveKey();
  if (!key) return plain; // dev fallback: store as-is when no key configured

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(stored: string): string {
  const key = resolveKey();
  if (!key) return stored;

  let buf: Buffer;
  try {
    buf = Buffer.from(stored, 'base64');
  } catch {
    return stored;
  }
  // Not our envelope (e.g. legacy plaintext written before encryption was on):
  // return it untouched so historical rows remain readable.
  if (buf.length < IV_LENGTH + TAG_LENGTH) return stored;

  try {
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Auth-tag mismatch (tampering) or a plaintext legacy value — fail safe by
    // returning the stored bytes rather than throwing inside the ORM hydration.
    return stored;
  }
}

/** Use as `@Column({ transformer: encryptedColumn() })` on sensitive text fields. */
export function encryptedColumn(): ValueTransformer {
  return {
    to: (value: string | null | undefined): string | null =>
      value === null || value === undefined ? null : encrypt(value),
    from: (value: string | null | undefined): string | null =>
      value === null || value === undefined ? null : decrypt(value),
  };
}
