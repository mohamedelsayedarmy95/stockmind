import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { AuditLogService } from '../audit/audit-log.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { CreateInvitationDto } from '../../application/dtos/team/team.dto';
import { UserRole } from '../../shared/constants/enums';
import { lockMemberExclusive } from '../security/member-lock';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashInvitationToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Series 09: 'active' | 'suspended' | 'removed'. The list includes removed members (history); clients hide them by default. */
  status: string;
  /** Company owner (metadata, separate from the Admin role). */
  isOwner: boolean;
  statusChangedAt: Date | null;
  /** 'all' for Admin and Manager; otherwise the granted warehouse ids. */
  warehouses: 'all' | string[];
}

/**
 * Team management inside one company: invitations, members and their warehouse grants. Every query is filtered by
 * the caller's companyId, so ids from another company answer 404.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    private readonly entitlements: EntitlementsService,
  ) {}

  getEntitlements(companyId: string) {
    return this.entitlements.get(companyId);
  }

  /** Returns the invitation token once; only its SHA-256 is stored. */
  async createInvitation(companyId: string, inviterId: string, dto: CreateInvitationDto) {
    const email = dto.email.trim();
    const warehouseIds = dto.role === 'Staff' ? [...new Set(dto.warehouseIds ?? [])] : [];
    if (dto.role === 'Staff' && !warehouseIds.length) {
      throw new BadRequestException('A Staff invitation needs at least one warehouse');
    }
    await this.assertCompanyWarehouses(companyId, warehouseIds);
    await this.entitlements.assertCanInvite(companyId);
    const [taken] = await this.dataSource.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (taken) throw new ConflictException('Email already registered');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const [row] = await this.dataSource.query(
      `INSERT INTO team_invitations (company_id, email, role, warehouse_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [companyId, email, dto.role, warehouseIds, hashInvitationToken(token), inviterId, expiresAt],
    );
    await this.audit.write({
      actorUserId: inviterId, companyId, action: 'TEAM_INVITATION_CREATED', entityType: 'team_invitation',
      entityId: row.id, newValues: { email, role: dto.role, warehouseIds },
    });
    return { id: row.id as string, email, role: dto.role, warehouseIds, expiresAt, token };
  }

  /** Pending invitations (not accepted, revoked or expired); never the token. */
  async listInvitations(companyId: string) {
    return this.dataSource.query(
      `SELECT id, email, role, warehouse_ids AS "warehouseIds", expires_at AS "expiresAt", created_at AS "createdAt"
       FROM team_invitations
       WHERE company_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [companyId],
    );
  }

  async revokeInvitation(companyId: string, actorId: string, id: string): Promise<void> {
    // For UPDATE ... RETURNING, TypeORM's postgres query() returns [rows, affectedCount].
    const [revoked] = await this.dataSource.query(
      `UPDATE team_invitations SET revoked_at = now()
       WHERE id = $1 AND company_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id`,
      [id, companyId],
    );
    if (!revoked.length) throw new NotFoundException('Invitation not found');
    await this.audit.write({
      actorUserId: actorId, companyId, action: 'TEAM_INVITATION_REVOKED', entityType: 'team_invitation', entityId: id,
    });
  }

  async listMembers(companyId: string): Promise<TeamMember[]> {
    const rows: Array<Omit<TeamMember, 'warehouses'> & { ids: string[] }> =
      await this.dataSource.query(
        `SELECT u.id, u.name, u.email, u.role, u.status, u.is_owner AS "isOwner", u.status_changed_at AS "statusChangedAt",
                COALESCE(array_agg(a.warehouse_id) FILTER (WHERE a.warehouse_id IS NOT NULL), '{}') AS ids
         FROM users u LEFT JOIN warehouse_access a ON a.user_id = u.id AND a.company_id = u.company_id
         WHERE u.company_id = $1
         GROUP BY u.id ORDER BY u.created_at`,
        [companyId],
      );
    return rows.map(({ ids, ...m }) => ({
      ...m,
      warehouses: m.role === UserRole.ADMIN || m.role === UserRole.MANAGER ? 'all' : ids,
    }));
  }

  /** Replaces a Staff member's warehouse grants. Admin and Manager always see every warehouse. */
  async setWarehouseAccess(companyId: string, actorId: string, memberId: string, warehouseIds: string[]) {
    const ids = [...new Set(warehouseIds)];
    const [member] = await this.dataSource.query(
      `SELECT role FROM users WHERE id = $1 AND company_id = $2 AND status <> 'removed'`, [memberId, companyId],
    );
    if (!member) throw new NotFoundException('Member not found');
    if (member.role !== UserRole.STAFF) {
      throw new BadRequestException('Admin and Manager have access to every warehouse');
    }
    await this.assertCompanyWarehouses(companyId, ids);
    await this.dataSource.transaction(async (m) => {
      // Series 10: every change of a member's access takes the member row FOR UPDATE (it serializes against that member's
      // in-flight stock writes, which hold it FOR SHARE) and leaves evidence in the same transaction.
      await lockMemberExclusive(m, memberId);
      await m.query(`SELECT 1 FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE`, [memberId, companyId]);
      const before: string[] = (await m.query(
        `SELECT warehouse_id FROM warehouse_access WHERE user_id = $1 AND company_id = $2`, [memberId, companyId],
      )).map((r: { warehouse_id: string }) => r.warehouse_id);
      // A warehouse already covered by an active scoped grant (e.g. warehouse_manager) needs no second, weaker row.
      const covered: string[] = (await m.query(
        `SELECT scope_id FROM access_grants WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL`, [memberId, companyId],
      )).map((r: { scope_id: string }) => r.scope_id);
      const wanted = ids.filter((id) => !covered.includes(id));
      await m.query(`DELETE FROM warehouse_access WHERE user_id = $1 AND company_id = $2`, [memberId, companyId]);
      if (wanted.length) {
        await m.query(
          `INSERT INTO warehouse_access (company_id, user_id, warehouse_id, granted_by)
           SELECT $1, $2, unnest($3::uuid[]), $4`,
          [companyId, memberId, wanted, actorId],
        );
      }
      for (const [type, list] of [['grant', wanted.filter((id) => !before.includes(id))], ['revoke', before.filter((id) => !wanted.includes(id))]] as const) {
        for (const warehouseId of list) {
          await m.query(
            `INSERT INTO access_grant_events (company_id, actor_user_id, target_user_id, warehouse_id, event_type, profile_key,
                                              profile_version, previous_profile_key, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'legacy_api')`,
            [companyId, actorId, memberId, warehouseId, type, type === 'grant' ? 'operator' : null, type === 'grant' ? 1 : null, type === 'revoke' ? 'operator' : null],
          );
        }
      }
    });
    await this.audit.write({
      actorUserId: actorId, companyId, action: 'WAREHOUSE_ACCESS_SET', entityType: 'user', entityId: memberId,
      newValues: { warehouseIds: ids },
    });
    return { id: memberId, warehouses: ids };
  }

  private async assertCompanyWarehouses(companyId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM warehouses WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, ids],
    );
    if (n !== ids.length) throw new NotFoundException('Warehouse not found or access denied');
  }
}
