import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WarehouseAccessService } from '../../infrastructure/security/warehouse-access.service';
import { JwtPayload } from '../decorators/current-user.decorator';

export const WAREHOUSE_REFS_KEY = 'warehouse_refs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a request names a warehouse: a route parameter, a body field or a query parameter. */
export type WarehouseRef = `${'params' | 'body' | 'query'}.${string}`;

/**
 * Requires the caller to be allowed to use every warehouse the request names (see WarehouseAccessService).
 * Missing or malformed ids are left to validation, which rejects them.
 */
export const WarehouseScoped = (...refs: WarehouseRef[]) =>
  applyDecorators(SetMetadata(WAREHOUSE_REFS_KEY, refs), UseGuards(WarehouseAccessGuard));

/** The warehouse ids a request names through its @WarehouseScoped refs (well-formed ones only). */
export function requestedWarehouseIds(reflector: Reflector, context: ExecutionContext, req?: any): string[] {
  const refs = reflector.get<WarehouseRef[]>(WAREHOUSE_REFS_KEY, context.getHandler()) ?? [];
  const request = req ?? context.switchToHttp().getRequest();
  return refs
    .map((ref) => {
      const [source, field] = ref.split('.');
      return (request[source] as Record<string, unknown> | undefined)?.[field];
    })
    .filter((value): value is string => typeof value === 'string' && UUID.test(value));
}

@Injectable()
export class WarehouseAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: WarehouseAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException('No authenticated user');
    const ids = requestedWarehouseIds(this.reflector, context, req);
    if (ids.length) await this.access.assertCanUse(user.sub, user.companyId, ids);
    return true;
  }
}
