import { IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../../shared/validators/strong-password.validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @IsStrongPassword()
  newPassword!: string;
}
