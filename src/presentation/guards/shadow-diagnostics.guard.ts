import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/** The header that carries the operator token (redacted from request logs: shared/logging/http-logger.options.ts). */
export const SHADOW_DIAGNOSTICS_HEADER = 'x-shadow-diagnostics-token';
const MIN_TOKEN_LENGTH = 32;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Series 13 / N-2: who may read or roll the shadow evidence window. Pure, for testing.
 *
 * The evidence spans every company of the process, so no tenant role (not even an Admin) may see it. It is an OPERATOR
 * tool for a local rehearsal, and all three conditions must hold:
 *  1. enabled: SHADOW_DIAGNOSTICS_TOKEN is set to at least 32 characters (unset by default, so the route does not exist);
 *  2. the TCP peer of the connection is the loopback interface. The socket address, never `req.ip` or X-Forwarded-For: a
 *     header is chosen by the client, and behind a proxy the peer is the proxy, which is refused;
 *  3. the request carries the same token (compared in constant time over digests).
 */
export function shadowDiagnosticsAllowed(remoteAddress: string | undefined, presented: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.SHADOW_DIAGNOSTICS_TOKEN;
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) return false;
  if (!remoteAddress || !LOOPBACK.has(remoteAddress)) return false;
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(token, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Refuses with the router's own 404, so a refused caller cannot tell the route exists. */
@Injectable()
export class ShadowDiagnosticsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!shadowDiagnosticsAllowed(req.socket?.remoteAddress, req.headers[SHADOW_DIAGNOSTICS_HEADER])) {
      throw new NotFoundException(`Cannot ${req.method} ${req.originalUrl ?? req.url}`);
    }
    return true;
  }
}
