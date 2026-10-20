import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
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

const TOTP_STEP_S = 30;
const TOTP_WINDOW = 1; // tolerate ±1 time-step for clock drift
const BACKUP_CODE = /^[0-9A-F]{8}$/; // 4 random bytes as upper-case hex (see verifyAndEnable)

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
   * An active factor is never replaced here: that would let anyone holding an access token switch 2FA off or enrol
   * their own authenticator. The user disables it first, which requires the password.
   */
  async generateSecret(userId: string, email: string): Promise<TwoFactorSetup> {
    let row = await this.repo.findOne({ where: { userId } });
    if (row?.isEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled; disable it first');
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${this.issuer} (${email})`,
      issuer: this.issuer,
    });

    const otpauthUrl = secret.otpauth_url ?? '';

    // Upsert: re-enrolling replaces any previous (still-unverified) secret.
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

    const step = this.matchedStep(row.secretKey, otpCode);
    if (step === null) throw new BadRequestException('Invalid verification code');

    const plainCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashed = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 10)));

    row.isEnabled = true;
    row.backupCodes = JSON.stringify(hashed);
    // The enrolment code counts as used: it cannot then complete a sign-in.
    row.lastTotpStep = String(Math.max(step, Number(row.lastTotpStep ?? -1)));
    await this.repo.save(row);

    return { backupCodes: plainCodes };
  }

  /**
   * Verify a login-time OTP or consume a one-time backup code. Each succeeds at most once: a TOTP code only for a
   * time-step later than the last accepted one, a backup code only while it is still stored. When this returns
   * true the consumption is already committed, so a session is never issued for an unconsumed code.
   */
  async verifyCode(userId: string, otpCode: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row || !row.isEnabled) return false;

    const step = this.matchedStep(row.secretKey, otpCode);
    if (step !== null) return this.consumeStep(userId, step);

    const backupCode = otpCode.toUpperCase();
    return BACKUP_CODE.test(backupCode) ? this.consumeBackupCode(userId, backupCode) : false;
  }

  /** Time-step of the code if it is valid within the drift window, else null. */
  private matchedStep(secret: string, otpCode: string): number | null {
    const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_S);
    const match = speakeasy.totp.verifyDelta({
      secret,
      encoding: 'base32',
      token: otpCode,
      window: TOTP_WINDOW,
      counter,
    });
    return match ? counter + match.delta : null;
  }

  /**
   * Records `step` as the last accepted one unless that step or a later one was already accepted. A single
   * conditional UPDATE: of concurrent attempts with the same code, in any process, at most one matches.
   */
  private async consumeStep(userId: string, step: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(UserTwoFactor)
      .set({ lastTotpStep: String(step) })
      .where('user_id = :userId AND is_enabled = true AND (last_totp_step IS NULL OR last_totp_step < :step)', {
        userId,
        step,
      })
      .execute();
    return result.affected === 1;
  }

  /** Removes a matching backup code under a row lock, so concurrent attempts cannot both use it. */
  private consumeBackupCode(userId: string, code: string): Promise<boolean> {
    return this.repo.manager.transaction(async (manager) => {
      const row = await manager.findOne(UserTwoFactor, {
        where: { userId, isEnabled: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row?.backupCodes) return false;
      const hashes: string[] = JSON.parse(row.backupCodes);
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(code, hashes[i])) {
          hashes.splice(i, 1);
          row.backupCodes = JSON.stringify(hashes);
          await manager.save(row);
          return true;
        }
      }
      return false;
    });
  }

  /** Fully disable and delete the secret (caller must verify the password first). */
  async disable(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
