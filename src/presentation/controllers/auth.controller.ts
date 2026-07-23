import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, RequestContext } from '../../infrastructure/repositories/auth.service';
import { RegisterDto } from '../../application/dtos/auth/register.dto';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { RefreshTokenDto } from '../../application/dtos/auth/refresh-token.dto';
import { ChangePasswordDto } from '../../application/dtos/auth/change-password.dto';
import {
  VerifyTwoFactorDto,
  DisableTwoFactorDto,
  TwoFactorLoginDto,
} from '../../application/dtos/auth/two-factor.dto';
import { Public } from '../../presentation/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../presentation/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private ctx(req: Request): RequestContext {
    return {
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    // Returns either the token pair (no 2FA) or { requires_2fa, temp_token }.
    return this.authService.login(dto, this.ctx(req));
  }

  @Public()
  @Post('2fa/login')
  @HttpCode(HttpStatus.OK)
  twoFactorLogin(@Body() dto: TwoFactorLoginDto) {
    return this.authService.twoFactorLogin(dto.tempToken, dto.otpCode);
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @Post('sessions/terminate-all')
  @HttpCode(HttpStatus.OK)
  terminateAll(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.terminateAllSessions(user.sub, user.companyId, this.ctx(req));
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(
      user.sub,
      user.companyId,
      dto.currentPassword,
      dto.newPassword,
      this.ctx(req),
    );
  }

  // ── Two-factor enrolment (authenticated) ──────────────────────────────────

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enable2fa(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.enableTwoFactor(user.sub, user.companyId, this.ctx(req));
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  verify2fa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyTwoFactorDto,
    @Req() req: Request,
  ) {
    return this.authService.verifyTwoFactor(user.sub, user.companyId, dto.otpCode, this.ctx(req));
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  disable2fa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DisableTwoFactorDto,
    @Req() req: Request,
  ) {
    return this.authService.disableTwoFactor(user.sub, user.companyId, dto.password, this.ctx(req));
  }
}
