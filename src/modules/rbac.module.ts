import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../domain/entities/role.entity';
import { Permission } from '../domain/entities/permission.entity';
import { RolePermission } from '../domain/entities/role-permission.entity';
import { UserRoleLink } from '../domain/entities/user-role.entity';
import { PermissionService } from '../infrastructure/repositories/permission.service';
import { WarehouseAccessService } from '../infrastructure/security/warehouse-access.service';
import { CapabilityService, CapabilityShadowService } from '../infrastructure/security/capability.service';
import { AccessGrantService } from '../infrastructure/repositories/access-grant.service';
import { MeController } from '../presentation/controllers/me.controller';
import { ShadowDiagnosticsController } from '../presentation/controllers/shadow-diagnostics.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, RolePermission, UserRoleLink])],
  controllers: [MeController, ShadowDiagnosticsController],
  providers: [PermissionService, WarehouseAccessService, CapabilityService, CapabilityShadowService, AccessGrantService],
  exports: [PermissionService, WarehouseAccessService, CapabilityService, CapabilityShadowService, AccessGrantService],
})
export class RbacModule {}
