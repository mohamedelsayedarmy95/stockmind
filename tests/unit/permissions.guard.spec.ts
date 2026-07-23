import { PermissionsGuard } from '../../src/presentation/guards/permissions.guard';
import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS } from '../../src/shared/constants/permissions.constant';

function buildContext(user: { sub: string; role: string } | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

describe('PermissionsGuard', () => {
  const permService = { hasAll: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new PermissionsGuard(reflector as never, permService as never);

  beforeEach(() => jest.clearAllMocks());

  it('allows when handler has no permission requirements', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(buildContext({ sub: 'u', role: 'Staff' }))).resolves.toBe(true);
  });

  it('allows Admin via legacy role map (no DB hit)', async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MANAGE_ROLES]);
    await expect(guard.canActivate(buildContext({ sub: 'u', role: 'Admin' }))).resolves.toBe(true);
    expect(permService.hasAll).not.toHaveBeenCalled();
  });

  it('falls through to DB check when legacy map insufficient', async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MANAGE_ROLES]);
    permService.hasAll.mockResolvedValue(false);
    await expect(guard.canActivate(buildContext({ sub: 'u', role: 'Staff' })))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws Forbidden when there is no user in the request', async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.VIEW_PRODUCT]);
    await expect(guard.canActivate(buildContext(undefined)))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
