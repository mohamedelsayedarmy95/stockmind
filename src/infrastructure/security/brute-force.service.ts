import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { LoginAttempt } from '../../domain/entities/login-attempt.entity';
import { AuditLogService } from '../audit/audit-log.service';

// Policy thresholds (per task spec).
const SHORT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const SHORT_MAX_FAILURES = 5; //   → 5 fails in 15m ⇒ locked
const LONG_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LONG_MAX_FAILURES = 10; //  → 10 fails in 1h ⇒ locked

@Injectable()
export class BruteForceService {
  constructor(
    @InjectRepository(LoginAttempt)
    private readonly repo: Repository<LoginAttempt>,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Throws HTTP 429 (with Retry-After semantics in the message) if the
   * email/IP pair has exceeded the failure thresholds inside either window.
   * Called BEFORE the password is ever checked, so a locked account leaks no
   * information about credential validity.
   */
  async assertNotLocked(email: string, ipAddress: string | null): Promise<void> {
    const now = Date.now();

    const shortFailures = await this.countFailures(email, ipAddress, new Date(now - SHORT_WINDOW_MS));
    if (shortFailures >= SHORT_MAX_FAILURES) {
      throw new HttpException(
        'Account temporarily locked due to repeated failed logins. Try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const longFailures = await this.countFailures(email, ipAddress, new Date(now - LONG_WINDOW_MS));
    if (longFailures >= LONG_MAX_FAILURES) {
      throw new HttpException(
        'Account locked due to excessive failed logins. Try again in 1 hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private countFailures(email: string, ipAddress: string | null, since: Date): Promise<number> {
    return this.repo.count({
      where: {
        email,
        successful: false,
        createdAt: MoreThan(since),
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
  }

  /** Record every attempt; failed attempts also raise a dedicated audit event. */
  async record(
    email: string,
    ipAddress: string | null,
    userAgent: string | null,
    successful: boolean,
  ): Promise<void> {
    await this.repo.insert({ email, ipAddress, userAgent, successful });

    if (!successful) {
      await this.audit.write({
        action: 'LOGIN_FAILED',
        entityType: 'auth',
        ipAddress,
        userAgent,
        // email is an identifier, not a secret — safe to record for forensics.
        newValues: { email },
      });
    }
  }
}
