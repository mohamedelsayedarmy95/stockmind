import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../domain/entities/user.entity';
import { Company } from '../../domain/entities/company.entity';
import { Warehouse } from '../../domain/entities/warehouse.entity';
import { UserRole } from '../../shared/constants/enums';
import { RegisterDto } from '../../application/dtos/auth/register.dto';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { TwoFactorService } from '../security/two-factor.service';
import { BruteForceService } from '../security/brute-force.service';
import { AuditLogService } from '../audit/audit-log.service';

/** Per-request network context, used for brute-force tracking and audit. */
export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(Warehouse) private readonly warehouseRepo: Repository<Warehouse>,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly dataSource: DataSource,
    private readonly twoFactor: TwoFactorService,
    private readonly bruteForce: BruteForceService,
    private readonly audit: AuditLogService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const company = qr.manager.create(Company, {
        name: dto.companyName,
        taxId: dto.taxId ?? null,
        currency: dto.currency ?? 'USD',
      });
      await qr.manager.save(company);

      const warehouse = qr.manager.create(Warehouse, {
        companyId: company.id,
        name: 'Main Warehouse',
        isActive: true,
      });
      await qr.manager.save(warehouse);

      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = qr.manager.create(User, {
        companyId: company.id,
        warehouseId: warehouse.id,
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: UserRole.ADMIN,
      });
      await qr.manager.save(user);

      await qr.commitTransaction();

      const tokens = await this.generateTokens(user);
      await this.storeRefreshHash(user.id, tokens.refreshToken);

      return {
        ...tokens,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        company: { id: company.id, name: company.name },
        defaultWarehouse: { id: warehouse.id, name: warehouse.name },
      };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * Issues a full token pair for an already-authenticated SSO user (called from
   * SamlController after Passport validates the SAML assertion).
   * Never touches brute-force counters or 2FA — the IdP already handled auth.
   */
  async issueTokensForSsoUser(user: User, ctx: RequestContext = {}) {
    const tokens = await this.generateTokens(user);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    await this.audit.write({
      actorUserId: user.id,
      companyId: user.companyId,
      action: 'SSO_LOGIN',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async login(dto: LoginDto, ctx: RequestContext = {}) {
    const ip = ctx.ipAddress ?? null;
    const ua = ctx.userAgent ?? null;

    // When the installation is configured for SSO-only, reject local logins and
    // tell the client where to redirect. Users who have a local password AND an
    // SSO link can still log in via either path when AUTH_PROVIDER=local.
    if (this.cfg.get<string>('AUTH_PROVIDER') === 'saml') {
      throw new BadRequestException({
        code: 'SSO_REQUIRED',
        message:
          'This installation uses Single Sign-On. ' +
          'Please authenticate via your identity provider.',
        loginUrl: '/api/v1/auth/saml/login',
      });
    }

    // Gate 1: brute-force lockout — checked before any credential comparison so
    // a locked source learns nothing about whether the password was right.
    await this.bruteForce.assertNotLocked(dto.email, ip);

    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      relations: ['company'],
    });

    const valid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !valid) {
      await this.bruteForce.record(dto.email, ip, ua, false);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.bruteForce.record(dto.email, ip, ua, true);

    // Gate 2: if 2FA is active, do NOT issue real tokens yet. Hand back a
    // short-lived temp token that only the /2fa/login step can redeem.
    if (await this.twoFactor.isEnabled(user.id)) {
      const tempToken = await this.jwt.signAsync(
        { sub: user.id, purpose: '2fa_pending' },
        { secret: this.twoFactorSecret(), expiresIn: '2m' },
      );
      return { requires_2fa: true as const, temp_token: tempToken };
    }

    const tokens = await this.generateTokens(user);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  /** Second step of a 2FA login: temp token + OTP → final token pair. */
  async twoFactorLogin(tempToken: string, otpCode: string) {
    let payload: { sub?: string; purpose?: string };
    try {
      payload = this.jwt.verify(tempToken, { secret: this.twoFactorSecret() });
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA session');
    }
    if (payload.purpose !== '2fa_pending' || !payload.sub) {
      throw new UnauthorizedException('Invalid 2FA session');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Invalid 2FA session');

    const ok = await this.twoFactor.verifyCode(user.id, otpCode);
    if (!ok) throw new UnauthorizedException('Invalid verification code');

    const tokens = await this.generateTokens(user);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub as string } });
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hashMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!hashMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(user);
    await this.storeRefreshHash(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.userRepo.update(userId, { refreshTokenHash: null });
  }

  /**
   * Terminate ALL active sessions for a user by invalidating the stored refresh
   * token hash. Any outstanding refresh token immediately stops working; access
   * tokens expire naturally within their short TTL.
   */
  async terminateAllSessions(userId: string, companyId: string, ctx: RequestContext = {}) {
    await this.userRepo.update(userId, { refreshTokenHash: null });
    await this.audit.write({
      actorUserId: userId,
      companyId,
      action: 'SESSIONS_TERMINATED',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { terminated: true };
  }

  async changePassword(
    userId: string,
    companyId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext = {},
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // Rotating the password also invalidates every existing session.
    await this.userRepo.update(userId, { passwordHash, refreshTokenHash: null });

    await this.audit.write({
      actorUserId: userId,
      companyId,
      action: 'PASSWORD_CHANGED',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { changed: true };
  }

  // ── 2FA enrolment orchestration (audited) ─────────────────────────────────

  async enableTwoFactor(userId: string, companyId: string, ctx: RequestContext = {}) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const setup = await this.twoFactor.generateSecret(userId, user.email);
    await this.audit.write({
      actorUserId: userId,
      companyId,
      action: '2FA_ENROLMENT_STARTED',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    // Only the QR + otpauth URL leave the server; the raw secret is echoed for
    // manual entry but never logged (audit records no secret material).
    return setup;
  }

  async verifyTwoFactor(userId: string, companyId: string, otpCode: string, ctx: RequestContext = {}) {
    const result = await this.twoFactor.verifyAndEnable(userId, otpCode);
    await this.audit.write({
      actorUserId: userId,
      companyId,
      action: '2FA_ENABLED',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { enabled: true, backupCodes: result.backupCodes };
  }

  async disableTwoFactor(
    userId: string,
    companyId: string,
    password: string,
    ctx: RequestContext = {},
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new BadRequestException('Password is incorrect');

    await this.twoFactor.disable(userId);
    await this.audit.write({
      actorUserId: userId,
      companyId,
      action: '2FA_DISABLED',
      entityType: 'auth',
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { disabled: true };
  }

  private twoFactorSecret(): string {
    // Distinct from the access secret so a temp token can never be replayed as
    // an access token against the global JWT guard.
    return (
      this.cfg.get<string>('JWT_2FA_SECRET') ??
      `${this.cfg.get<string>('JWT_REFRESH_SECRET') ?? 'stockmind-refresh'}::2fa`
    );
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.id, companyId: user.companyId, role: user.role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.cfg.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.cfg.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshHash(userId: string, token: string) {
    const hash = await bcrypt.hash(token, 10);
    await this.userRepo.update(userId, { refreshTokenHash: hash });
  }
}
