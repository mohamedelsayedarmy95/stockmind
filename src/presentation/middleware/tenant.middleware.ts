import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt } from 'passport-jwt';
import { TenantContextService } from '../../infrastructure/context/tenant-context.service';

// Same extraction rule as JwtStrategy, so the tenant context and GlobalJwtGuard always read the same token.
const extractBearerToken = ExtractJwt.fromAuthHeaderAsBearerToken();

/**
 * Builds the per-request tenant context from a valid access token. It never rejects a request:
 * middleware runs before routing and cannot see @Public(), so GlobalJwtGuard alone decides access.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string) ?? (req as unknown as { id?: string }).id;

    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    let payload: { sub: string; companyId: string; role: string };
    try {
      payload = this.jwt.verify<{
        sub: string;
        companyId: string;
        role: string;
      }>(token, { secret: this.cfg.get<string>('JWT_ACCESS_SECRET') });
    } catch {
      // Invalid or expired: no context. The guard rejects protected routes; public ones (login, refresh) proceed.
      return next();
    }

    this.tenantContext.run(
      {
        userId: payload.sub,
        companyId: payload.companyId,
        role: payload.role,
        correlationId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
      () => next(),
    );
  }
}
