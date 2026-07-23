import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserTwoFactor } from '../../domain/entities/user-two-factor.entity';

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class TwoFactorService {
  private readonly issuer = 'StockMind';

  constructor(
    @InjectRepository(UserTwoFactor)
    private readonly repo: Repository<UserTwoFactor>,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { userId } });
    return Boolean(row?.isEnabled);
  }

  /**
   * Step 1 of enrolment: generate a fresh secret and a scannable QR code.
   * The row is stored with is_enabled=false — the factor is NOT active until
   * the user proves possession by verifying a code (see verifyAndEnable).
   */
  async generateSecret(userId: string, email: string): Promise<TwoFactorSetup> {
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${this.issuer} (${email})`,
      issuer: this.issuer,
    });

    const otpauthUrl = secret.otpauth_url ?? '';

    // Upsert: re-enrolling replaces any previous (still-unverified) secret.
    let row = await this.repo.findOne({ where: { userId } });
    if (!row) {
      row = this.repo.create({ userId });
    }
    row.secretKey = secret.base32;
    row.isEnabled = false;
    row.backupCodes = null;
    await this.repo.save(row);

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { secret: secret.base32, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Step 2 of enrolment: verify the first OTP, activate the factor, and mint
   * one-time backup codes. Returns the PLAINTEXT backup codes exactly once —
   * only their bcrypt hashes are persisted.
   */
  async verifyAndEnable(userId: string, otpCode: string): Promise<{ backupCodes: string[] }> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row) throw new BadRequestException('Two-factor enrolment not started');

    const valid = speakeasy.totp.verify({
      secret: row.secretKey,
      encoding: 'base32',
      token: otpCode,
      window: 1, // tolerate ±1 time-step for clock drift
    });
    if (!valid) throw new BadRequestException('Invalid verification code');

    const plainCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashed = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 10)));

    row.isEnabled = true;
    row.backupCodes = JSON.stringify(hashed);
    await this.repo.save(row);

    return { backupCodes: plainCodes };
  }

  /** Verify a login-time OTP or consume a one-time backup code. */
  async verifyCode(userId: string, otpCode: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row || !row.isEnabled) return false;

    const totpOk = speakeasy.totp.verify({
      secret: row.secretKey,
      encoding: 'base32',
      token: otpCode,
      window: 1,
    });
    if (totpOk) return true;

    // Fall back to backup codes — each is single-use and removed on consumption.
    if (row.backupCodes) {
      const hashes: string[] = JSON.parse(row.backupCodes);
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(otpCode, hashes[i])) {
          hashes.splice(i, 1);
          row.backupCodes = JSON.stringify(hashes);
          await this.repo.save(row);
          return true;
        }
      }
    }
    return false;
  }

  /** Fully disable and delete the secret (caller must verify the password first). */
  async disable(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
