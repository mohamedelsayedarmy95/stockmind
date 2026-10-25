import { ArrayMaxSize, Equals, IsArray, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsStrongPassword } from '../../../shared/validators/strong-password.validator';

/** Roles an Admin can invite. Owners (Admin) are created by registration only. */
export const INVITABLE_ROLES = ['Manager', 'Staff'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsIn(INVITABLE_ROLES)
  role!: InvitableRole;

  // Required for Staff (the warehouses they may use); ignored for Manager, who sees every warehouse.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  warehouseIds?: string[];
}

export class AcceptInvitationDto {
  @IsString()
  @Length(20, 200)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;
}

export class SetWarehouseAccessDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  warehouseIds!: string[];
}

/** Body of suspend / reactivate / revoke-sessions: an optional note that is kept in the membership history. */
export class MembershipActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Removal is the heavier action: it needs an explicit confirmation in the request itself. */
export class RemoveMemberDto extends MembershipActionDto {
  @Equals(true, { message: 'confirm must be true to remove a member' })
  confirm!: true;
}

export class ChangeRoleDto extends MembershipActionDto {
  @IsIn(['Admin', 'Manager', 'Staff'])
  role!: 'Admin' | 'Manager' | 'Staff';

  // Required (true) when the change gives the member company-wide access (to Manager or Admin).
  @IsOptional()
  @IsBoolean()
  acknowledgeCompanyWideAccess?: boolean;
}

/** One warehouse and the access profile the member gets there. */
export class AccessAssignmentDto {
  @IsUUID('all')
  warehouseId!: string;

  @IsString()
  @MaxLength(64)
  profile!: string;
}

/** Replaces the member's whole warehouse access. `expectedVersion` is the `version` the client read (stale => 409). */
export class SetMemberAccessDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AccessAssignmentDto)
  assignments!: AccessAssignmentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  expectedVersion?: string;
}
