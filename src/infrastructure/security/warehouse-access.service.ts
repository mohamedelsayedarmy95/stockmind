import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../shared/constants/enums';

/** Roles that may use every warehouse of their company. Everyone else needs a warehouse_access row per warehouse. */
const FULL_ACCESS_ROLES: ReadonlySet<string> = new Set([UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Server-side warehouse authorization for team members. The role and the grants are read from the database on every
 * check, so a revoked grant or a demotion applies to the next request, whatever the access token still says.
 */
@Injectable()
export class WarehouseAccessService {
  constructor(private readonly dataSource: DataSource) {}

  /** Whether a role may use every warehouse of its company (for callers that read the role inside their own transaction). */
  hasFullAccess(role: string): boolean {
    return FULL_ACCESS_ROLES.has(role);
  }

  /** null: every warehouse of the company; otherwise the ids of the warehouses this user may use. */
  async scope(userId: string, companyId: string): Promise<string[] | null> {
    const rows: Array<{ role: string; ids: string[] }> = await this.dataSource.query(
      `SELECT u.role,
              COALESCE(array_agg(a.warehouse_id) FILTER (WHERE a.warehouse_id IS NOT NULL), '{}') AS ids
       FROM users u
       LEFT JOIN warehouse_access a ON a.user_id = u.id AND a.company_id = u.company_id
       WHERE u.id = $1 AND u.company_id = $2
       GROUP BY u.role`,
      [userId, companyId],
    );
    if (!rows.length) throw new ForbiddenException('Unknown user for this company');
    return FULL_ACCESS_ROLES.has(rows[0].role) ? null : rows[0].ids;
  }

  /** 404 (as for another company's warehouse) unless the user may use every listed warehouse. */
  async assertCanUse(userId: string, companyId: string, warehouseIds: string[]): Promise<void> {
    const scope = await this.scope(userId, companyId);
    if (scope === null) return;
    const allowed = new Set(scope);
    if (warehouseIds.some((id) => !allowed.has(id))) {
      throw new NotFoundException('Warehouse not found or access denied');
    }
  }
}
