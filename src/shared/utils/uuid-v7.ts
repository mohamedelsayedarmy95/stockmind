import { randomBytes } from 'crypto';

export function generateUuidV7(): string {
  const now = Date.now();
  const bytes = randomBytes(16);

  // Bytes 0-5: 48-bit Unix timestamp in milliseconds (big-endian)
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  // Byte 6: version 7 (0111xxxx)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // Byte 8: variant 10xxxxxx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
