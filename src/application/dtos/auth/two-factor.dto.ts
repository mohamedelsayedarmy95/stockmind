import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

/** A 6-digit TOTP code (or an 8-char backup code) supplied by the user. */
export class VerifyTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 10)
  otpCode!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

/** Second step of a 2FA login: exchange the short-lived temp token + OTP for real tokens. */
export class TwoFactorLoginDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9A-Za-z]{6,10}$/)
  otpCode!: string;
}
