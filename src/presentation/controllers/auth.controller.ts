import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService, RequestContext } from '../../infrastructure/repositories/auth.service';
import { RegisterDto } from '../../application/dtos/auth/register.dto';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { GoogleAuthDto } from '../../application/dtos/auth/google-auth.dto';
import { RefreshTokenDto } from '../../application/dtos/auth/refresh-token.dto';
import { ChangePasswordDto } from '../../application/dtos/auth/change-password.dto';
import {
  VerifyTwoFactorDto,
  DisableTwoFactorDto,
  TwoFactorLoginDto,
} from '../../application/dtos/auth/two-factor.dto';
import { Public } from '../../presentation/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../presentation/decorators/current-user.decorator';

@ApiTags('Auth')
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user (returns JWT or 2FA challenge)' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    // Returns either the token pair (no 2FA) or { requires_2fa, temp_token }.
    return this.authService.login(dto, this.ctx(req));
  }

  @Public()
  @Post('2fa/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA and complete login' })
  @ApiResponse({ status: 200, description: '2FA verified, tokens issued' })
  twoFactorLogin(@Body() dto: TwoFactorLoginDto, @Req() req: Request) {
    return this.authService.twoFactorLogin(dto.tempToken, dto.otpCode, this.ctx(req));
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google OAuth login' })
  @ApiResponse({ status: 200, description: 'Google login successful' })
  googleAuth(@Body() dto: GoogleAuthDto, @Req() req: Request) {
    return this.authService.googleLogin(dto.idToken, this.ctx(req));
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user (revoke refresh token)' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @Post('sessions/terminate-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate all sessions for the user' })
  @ApiResponse({ status: 200, description: 'All sessions terminated' })
  terminateAll(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.terminateAllSessions(user.sub, user.companyId, this.ctx(req));
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed' })
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
  @ApiOperation({ summary: 'Enable two-factor authentication for user' })
  @ApiResponse({ status: 200, description: '2FA enabled, returns secret and QR code' })
  enable2fa(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return this.authService.enableTwoFactor(user.sub, user.companyId, this.ctx(req));
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA during enrollment' })
  @ApiResponse({ status: 200, description: '2FA verified and enabled' })
  verify2fa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyTwoFactorDto,
    @Req() req: Request,
  ) {
    return this.authService.verifyTwoFactor(user.sub, user.companyId, dto.otpCode, this.ctx(req));
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable two-factor authentication' })
  @ApiResponse({ status: 200, description: '2FA disabled' })
  disable2fa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DisableTwoFactorDto,
    @Req() req: Request,
  ) {
    return this.authService.disableTwoFactor(user.sub, user.companyId, dto.password, this.ctx(req));
  }
}