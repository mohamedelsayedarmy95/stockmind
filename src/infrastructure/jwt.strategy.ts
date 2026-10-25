import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { DataSource } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../presentation/decorators/current-user.decorator';
import { MemberStatus } from '../shared/constants/enums';

/** The refusal a client can recognise: the member's access was suspended/removed or their sessions were revoked. */
export const accessRevoked = (message = 'Access has been revoked') =>
  new UnauthorizedException({ code: 'ACCESS_REVOKED', message });

/**
 * The single place where an access token becomes an authenticated principal.
 *
 * The signature and expiry are verified by passport-jwt; this then re-reads the member's row, so the decision does not
 * rest on what the token said when it was issued (Series 09 / S1):
 *   - status: a suspended or removed member is refused at once, not at token expiry;
 *   - token_version: a token issued before a revocation (suspend, remove, role change, "revoke sessions") carries an older
 *     `tv` and is refused (absent `tv` = 0, the version of every token issued before this feature);
 *   - company and role come from the row, never from the claim, so a role change takes effect on the next request.
 * One primary-key lookup per authenticated request; no cache, because a cache would reintroduce the delay.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private readonly dataSource: DataSource) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: Record<string, unknown>): Promise<JwtPayload> {
    const sub = payload.sub;
    if (typeof sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(sub)) throw new UnauthorizedException();

    const rows: Array<{ company_id: string; role: string; status: string; token_version: number }> =
      await this.dataSource.query(
        `SELECT company_id, role::text AS role, status, token_version FROM users WHERE id = $1`,
        [sub],
      );
    const row = rows[0];
    if (!row) throw new UnauthorizedException();
    if (row.status !== MemberStatus.ACTIVE) throw accessRevoked();
    if (payload.companyId !== row.company_id) throw new UnauthorizedException();
    const issuedUnder = typeof payload.tv === 'number' ? payload.tv : 0;
    if (issuedUnder !== row.token_version) throw accessRevoked('Session was revoked');

    return { sub, companyId: row.company_id, role: row.role, tv: row.token_version };
  }
}
