import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../shared/constants/enums';
import { capabilityMode } from '../../shared/constants/capabilities.constant';
import { warehouseScope } from '../../domain/authorization/capability-evaluator';
import { CapabilityService, CapabilityShadowService } from './capability.service';

/** Roles that may use every warehouse of their company. Everyone else needs a warehouse_access row per warehouse. */
const FULL_ACCESS_ROLES: ReadonlySet<string> = new Set([UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Server-side warehouse authorization for team members. The role and the grants are read from the database on every
 * check, so a revoked grant or a demotion applies to the next request, whatever the access token still says.
 *
 * Series 10: the capability engine (CAPABILITY_MODE) decides which model answers. `off` and `shadow` use the legacy query
 * below (shadow also computes the new model and records any difference); `enforce` uses the capability model, where a
 * warehouse is usable through a warehouse_access row (implicit operator grant) OR an active scoped grant.
 */
@Injectable()
export class WarehouseAccessService {
  private readonly logger = new Logger(WarehouseAccessService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly capabilities: CapabilityService,
    private readonly shadow: CapabilityShadowService,
  ) {}

  /** Whether a role may use every warehouse of its company (for callers that read the role inside their own transaction). */
  hasFullAccess(role: string): boolean {
    return FULL_ACCESS_ROLES.has(role);
  }

  /** The pre-Series-10 query, unchanged: the reference the parity tests compare the new model against. */
  async legacyScope(userId: string, companyId: string): Promise<string[] | null> {
    const rows: Array<{ role: string; ids: string[] }> = await this.dataSource.query(
      `SELECT u.role,
              COALESCE(array_agg(a.warehouse_id) FILTER (WHERE a.warehouse_id IS NOT NULL), '{}') AS ids
       FROM users u
       LEFT JOIN warehouse_access a ON a.user_id = u.id AND a.company_id = u.company_id
       WHERE u.id = $1 AND u.company_id = $2 AND u.status = 'active'
       GROUP BY u.role`,
      [userId, companyId],
    );
    if (!rows.length) throw new ForbiddenException('Unknown user for this company');
    return FULL_ACCESS_ROLES.has(rows[0].role) ? null : rows[0].ids;
  }

  /** The capability model's scope for the same member. */
  private async scopedScope(userId: string, companyId: string): Promise<string[] | null> {
    const principal = await this.capabilities.loadPrincipal(userId, companyId);
    if (!principal || principal.status !== 'active') throw new ForbiddenException('Unknown user for this company');
    return warehouseScope(principal, 'scoped');
  }

  /** null: every warehouse of the company; otherwise the ids this user may use. */
  async scope(userId: string, companyId: string): Promise<string[] | null> {
    const mode = capabilityMode();
    if (mode === 'enforce') return this.scopedScope(userId, companyId);
    const legacy = await this.legacyScope(userId, companyId);
    if (mode === 'shadow') await this.compareScope(userId, companyId, legacy);
    return legacy;
  }

  private async compareScope(userId: string, companyId: string, legacy: string[] | null): Promise<void> {
    try {
      // One snapshot serves both the new scope and the explanation of any difference.
      const principal = await this.capabilities.loadPrincipal(userId, companyId);
      this.shadow.observeScope({
        route: 'WarehouseAccessService.scope', userId, requestCompanyId: companyId, principal,
        legacy, scoped: principal && principal.status === 'active' ? warehouseScope(principal, 'scoped') : null,
      });
    } catch (err) {
      this.shadow.error('scope', err, 'WarehouseAccessService.scope');
    }
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
