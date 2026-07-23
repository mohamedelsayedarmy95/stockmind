import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../domain/entities/role.entity';
import { Permission } from '../domain/entities/permission.entity';
import { RolePermission } from '../domain/entities/role-permission.entity';
import { UserRoleLink } from '../domain/entities/user-role.entity';
import { PermissionService } from '../infrastructure/repositories/permission.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, RolePermission, UserRoleLink])],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class RbacModule {}
