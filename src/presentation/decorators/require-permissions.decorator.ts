import { SetMetadata } from '@nestjs/common';
import { Permission } from '../../shared/constants/permissions.constant';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
