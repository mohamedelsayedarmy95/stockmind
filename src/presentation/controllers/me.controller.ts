import { Controller, ForbiddenException, Get, Header, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { CapabilityService } from '../../infrastructure/security/capability.service';
import { can, effectiveCapabilities } from '../../domain/authorization/capability-evaluator';
import { CAPABILITY_ENGINE_VERSION, capabilityMode } from '../../shared/constants/capabilities.constant';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

/** How long a client may treat a capability snapshot as current for the UI (the server decides every request anyway). */
const CAPABILITIES_TTL_SECONDS = 300;

/**
 * What the signed-in member may do, for building the app's navigation (ADR-H). It is a description for the UI, NOT an
 * authorization: every endpoint decides for itself, so a stale or tampered copy on a device can hide or show a button
 * but never grant anything.
 *
 * Contract:
 *  - Computed from the database on every call, in the model that is actually deciding (`engine.enforced`): while the
 *    engine does not enforce, this reports the legacy authority, so the UI never offers what the server would refuse.
 *  - `accessVersion` changes exactly when the member's authority changes; clients compare it, they do not infer.
 *  - `Cache-Control: no-store` and `Vary: Authorization`: no shared or browser cache may serve it, and a conditional
 *    request (304) is only possible when the freshly computed body is byte-identical.
 *  - Exposes only warehouses the member may use, never other members' grants, never cost values, never credentials.
 */
@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly capabilities: CapabilityService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  async myCapabilities(@CurrentUser() user: JwtPayload, @Req() req: any) {
    const principal = await this.capabilities.principalFor(req, user.sub, user.companyId);
    if (!principal) throw new ForbiddenException('Unknown user for this company');
    const mode = capabilityMode();
    const view = mode === 'enforce' ? 'scoped' : 'legacy';
    const warehouses: Array<{ id: string; name: string }> = await this.dataSource.query(
      `SELECT id, name FROM warehouses WHERE company_id = $1 AND deleted_at IS NULL ORDER BY name, id`, [user.companyId],
    );
    const effective = effectiveCapabilities(principal, view, warehouses.map((w) => w.id));
    const names = new Map(warehouses.map((w) => [w.id, w.name]));
    return {
      engine: { mode, enforced: mode === 'enforce', version: CAPABILITY_ENGINE_VERSION },
      accessVersion: this.capabilities.accessVersion(principal, effective),
      ttlSeconds: CAPABILITIES_TTL_SECONDS,
      membership: { status: principal.status, role: principal.role, isOwner: principal.isOwner },
      capabilities: {
        organization: effective.organization,
        financial: { viewCost: effective.canViewCost },
        team: { manage: can(principal, PERMISSIONS.MANAGE_USERS, { view }).allowed },
      },
      warehouses: {
        all: effective.allWarehouses,
        items: effective.warehouses.map((w) => ({
          id: w.warehouseId, name: names.get(w.warehouseId) ?? '', capabilities: w.capabilities, profiles: w.profiles,
        })),
      },
    };
  }
}
