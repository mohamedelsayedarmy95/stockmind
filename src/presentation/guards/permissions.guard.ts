import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionService } from '../../infrastructure/repositories/permission.service';
import { Permission, DEFAULT_ROLE_PERMISSIONS } from '../../shared/constants/permissions.constant';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { sub: string; role: string } | undefined;
    if (!user) throw new ForbiddenException('No authenticated user');

    // Fallback for users whose Role rows aren't yet migrated: rely on
    // legacy enum + DEFAULT_ROLE_PERMISSIONS map.
    const legacyPerms = new Set(DEFAULT_ROLE_PERMISSIONS[user.role] ?? []);
    if (required.every((p) => legacyPerms.has(p))) return true;

    const ok = await this.permissions.hasAll(user.sub, required);
    if (!ok) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
    }
    return true;
  }
}
