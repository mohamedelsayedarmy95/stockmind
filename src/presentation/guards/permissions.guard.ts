import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionService } from '../../infrastructure/repositories/permission.service';
import { Permission, DEFAULT_ROLE_PERMISSIONS } from '../../shared/constants/permissions.constant';
import { CapabilityService, CapabilityShadowService } from '../../infrastructure/security/capability.service';
import { canAll, warehouseScope } from '../../domain/authorization/capability-evaluator';
import { capabilityMode } from '../../shared/constants/capabilities.constant';
import { requestedWarehouseIds } from './warehouse-access.guard';

/**
 * Operation permission check. Three modes (CAPABILITY_MODE, read per request):
 *  - off:     the legacy decision only (role defaults, then the legacy roles tables);
 *  - shadow:  the legacy decision DECIDES; the capability model is computed alongside and any difference is recorded for the
 *             rollout review (it can never change the answer, and an error in it is swallowed);
 *  - enforce: the capability model decides: warehouse capabilities come from scoped grants, a warehouse the member may not
 *             use is answered like a warehouse that does not exist (404), a missing capability is a 403. A failure to
 *             evaluate denies (fail closed).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
    // Optional so a module that composes this guard without the capability model (the frozen production-equivalence
    // suites do) keeps the legacy decision; with the engine in `enforce` a missing model denies (fail closed).
    @Optional() private readonly capabilities?: CapabilityService,
    @Optional() private readonly shadow?: CapabilityShadowService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { sub: string; role: string; companyId?: string } | undefined;
    if (!user) throw new ForbiddenException('No authenticated user');

    const mode = capabilityMode();
    if (mode === 'enforce') return this.enforce(context, req, user, required);

    const legacyAllowed = await this.legacyAllows(user, required);
    if (mode === 'shadow' && user.companyId && this.capabilities && this.shadow) await this.compare(context, req, user, required, legacyAllowed);
    if (!legacyAllowed) throw this.deny(required);
    return true;
  }

  /** The decision the application made before the capability model existed. */
  private async legacyAllows(user: { sub: string; role: string }, required: Permission[]): Promise<boolean> {
    // Fallback for users whose Role rows aren't yet migrated: rely on
    // legacy enum + DEFAULT_ROLE_PERMISSIONS map.
    const legacyPerms = new Set(DEFAULT_ROLE_PERMISSIONS[user.role] ?? []);
    if (required.every((p) => legacyPerms.has(p))) return true;
    return this.permissions.hasAll(user.sub, required);
  }

  private deny(required: Permission[]): ForbiddenException {
    return new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
  }

  private async compare(
    context: ExecutionContext, req: any, user: { sub: string; companyId?: string }, required: Permission[], legacyAllowed: boolean,
  ): Promise<void> {
    try {
      const principal = await this.capabilities!.principalFor(req, user.sub, user.companyId as string);
      if (!principal) return;
      const ids = requestedWarehouseIds(this.reflector, context, req);
      // Legacy, as one question: permission AND warehouse scope (the scope was checked by a second guard).
      const legacyScope = warehouseScope(principal, 'legacy');
      const legacy = legacyAllowed && (legacyScope === null || ids.every((id) => legacyScope.includes(id)));
      const scoped = required.every((cap) => canAll(principal, cap, ids, 'scoped').allowed);
      this.shadow!.record({
        kind: 'permission', route: `${context.getClass().name}.${context.getHandler().name}`, userId: user.sub,
        capability: required.join('+'), warehouseIds: ids, legacy, scoped,
        expected: principal.grants.some((g) => g.source === 'access_grant'),
      });
    } catch (err) {
      this.shadow?.error();
      this.logger.warn(`shadow comparison failed: ${(err as Error).message}`);
    }
  }

  private async enforce(context: ExecutionContext, req: any, user: { sub: string; companyId?: string }, required: Permission[]): Promise<boolean> {
    let principal;
    try {
      principal = user.companyId && this.capabilities ? await this.capabilities.principalFor(req, user.sub, user.companyId) : null;
    } catch (err) {
      this.logger.error(`capability evaluation failed: ${(err as Error).message}`);
      throw this.deny(required); // fail closed
    }
    if (!principal) throw this.deny(required);
    const ids = requestedWarehouseIds(this.reflector, context, req);
    for (const cap of required) {
      const decision = canAll(principal, cap, ids, 'scoped');
      if (decision.allowed) continue;
      if (decision.reason === 'out-of-scope' || decision.reason === 'no-grant') {
        throw new NotFoundException('Warehouse not found or access denied'); // same answer as a warehouse that does not exist
      }
      throw this.deny(required);
    }
    return true;
  }
}
