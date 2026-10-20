import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
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
