import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Network-layer allowlist for locked-down / on-premise deployments.
 *
 * When ALLOWED_IPS is set (comma-separated exact IPs), any request whose source
 * address is not on the list is rejected with 403 BEFORE authentication — the
 * API surface is invisible to anything outside the trusted enterprise network.
 *
 * When ALLOWED_IPS is empty/unset the guard is a no-op, so cloud/dev deployments
 * behave exactly as before (non-breaking by default).
 *
 * NOTE: matching is exact-IP. CIDR ranges are intentionally out of scope here;
 * front the service with a firewall/VPN for range-based control. `trust proxy`
 * must be configured for req.ip to reflect the real client behind a reverse proxy.
 */
@Injectable()
export class IpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(IpAllowlistGuard.name);
  private readonly allowed: Set<string>;

  constructor(private readonly cfg: ConfigService) {
    const raw = this.cfg.get<string>('ALLOWED_IPS') ?? '';
    this.allowed = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.allowed.size === 0) return true; // feature disabled → allow all

    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.normalize(req.ip ?? req.socket?.remoteAddress ?? '');

    if (this.allowed.has(ip)) return true;

    this.logger.warn(`Blocked request from non-allowlisted IP: ${ip}`);
    throw new ForbiddenException('Access denied from this network');
  }

  /** Strip the IPv4-mapped-IPv6 prefix so "::ffff:10.0.0.5" matches "10.0.0.5". */
  private normalize(ip: string): string {
    return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  }
}
