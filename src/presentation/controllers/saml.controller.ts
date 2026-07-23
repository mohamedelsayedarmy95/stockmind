import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { AuthService } from '../../infrastructure/repositories/auth.service';
import type { User } from '../../domain/entities/user.entity';

/**
 * SAML 2.0 Service-Provider endpoints.
 *
 * All routes are @Public — the GlobalJwtGuard must not intercept them.
 * They are only registered when SAML_ENABLED=true (see SamlModule / app.module.ts).
 */
@Public()
@Controller('auth/saml')
export class SamlController {
  constructor(private readonly authService: AuthService) {}

  /**
   * SP-initiated login: Passport redirects the user-agent to the IdP login page.
   * The `AuthGuard('saml')` body never executes; the redirect happens in-strategy.
   *
   * GET /api/v1/auth/saml/login
   */
  @Get('login')
  @UseGuards(AuthGuard('saml'))
  login() {
    // Intentionally empty — passport-saml issues the IdP redirect before this runs.
  }

  /**
   * Assertion Consumer Service (ACS). The IdP POSTs the signed SAML assertion here.
   * Passport validates the signature; on success req.user is the matched User entity.
   *
   * POST /api/v1/auth/saml/callback
   *
   * Mobile apps deep-link: after issuing tokens we return JSON so the app can
   * capture `accessToken` / `refreshToken` from the WebView redirect and store them.
   * Browser-first clients may prefer a cookie or a redirect; adjust for your front-end.
   */
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('saml'))
  async callback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as User;
    const tokens = await this.authService.issueTokensForSsoUser(user, {
      ipAddress: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    return res.json(tokens);
  }

  /**
   * SP-initiated Single Logout (SLO). Redirects to the IdP logout URL.
   * The IdP then calls back to complete the logout.
   *
   * GET /api/v1/auth/saml/logout
   */
  @Get('logout')
  @UseGuards(AuthGuard('saml'))
  logout(@Res() res: Response) {
    // passport-saml handles the SLO redirect in-strategy.
    return res.json({ loggedOut: true });
  }
}
