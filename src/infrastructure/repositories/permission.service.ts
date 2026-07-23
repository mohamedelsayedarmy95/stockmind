import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRoleLink } from '../../domain/entities/user-role.entity';
import { RolePermission } from '../../domain/entities/role-permission.entity';
import { Permission } from '../../domain/entities/permission.entity';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(UserRoleLink) private readonly userRoleRepo: Repository<UserRoleLink>,
    @InjectRepository(RolePermission) private readonly rolePermRepo: Repository<RolePermission>,
    @InjectRepository(Permission) private readonly permissionRepo: Repository<Permission>,
  ) {}

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const rows: Array<{ name: string }> = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin('role_permissions', 'rp', 'rp.role_id = ur.role_id')
      .innerJoin('permissions', 'p', 'p.id = rp.permission_id')
      .where('ur.user_id = :userId', { userId })
      .select('DISTINCT p.name', 'name')
      .getRawMany();

    return new Set(rows.map((r) => r.name));
  }

  async hasAll(userId: string, required: string[]): Promise<boolean> {
    if (!required.length) return true;
    const owned = await this.getUserPermissions(userId);
    return required.every((r) => owned.has(r));
  }
}
