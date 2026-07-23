import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../infrastructure/context/tenant-context.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const correlationId = (req.headers['x-correlation-id'] as string) ?? (req as unknown as { id?: string }).id;

    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    try {
      const payload = this.jwt.verify<{
        sub: string;
        companyId: string;
        role: string;
      }>(token, { secret: this.cfg.get<string>('JWT_ACCESS_SECRET') });

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
    } catch {
      next();
    }
  }
}
