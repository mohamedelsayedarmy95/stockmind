import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, type PassportSamlConfig, type Profile } from '@node-saml/passport-saml';
import { User } from '../../domain/entities/user.entity';
import { UserSsoLink } from '../../domain/entities/user-sso-link.entity';

/** Well-known attribute claim URIs used by Active Directory / ADFS. */
const CLAIM_EMAIL =
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const CLAIM_NAME =
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name';

@Injectable()
export class SamlStrategy extends PassportStrategy(Strategy, 'saml') {
  constructor(
    cfg: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserSsoLink)
    private readonly ssoLinkRepo: Repository<UserSsoLink>,
  ) {
    const samlConfig: PassportSamlConfig = {
      entryPoint: cfg.getOrThrow<string>('SAML_ENTRY_POINT'),
      issuer: cfg.getOrThrow<string>('SAML_ISSUER'),
      callbackUrl: cfg.getOrThrow<string>('SAML_CALLBACK_URL'),
      idpCert: cfg.getOrThrow<string>('SAML_CERT'),
      // Require signed assertions; the response envelope signature is optional
      // (some IdPs only sign assertions, not the wrapping response).
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      signatureAlgorithm: 'sha256',
    };
    super(samlConfig);
  }

  /**
   * Called by Passport after the SAML assertion has been validated.
   * Finds (or first-time-links) the local StockMind user for this IdP identity.
   */
  async validate(profile: Profile): Promise<User> {
    const nameId = profile.nameID;
    if (!nameId) {
      throw new UnauthorizedException('SAML assertion is missing nameID');
    }

    // Normalise the email from common attribute claim URIs.
    const email =
      (profile[CLAIM_EMAIL] as string | undefined) ??
      (profile.email as string | undefined) ??
      '';

    // ── 1. Happy path: existing SSO link ────────────────────────────────────
    const link = await this.ssoLinkRepo.findOne({
      where: { provider: 'saml', providerUserId: nameId },
      relations: ['user'],
    });
    if (link) {
      // Keep the display name in sync on every login.
      const displayName =
        (profile[CLAIM_NAME] as string | undefined) ??
        (profile.displayName as string | undefined) ??
        null;
      if (displayName && displayName !== link.displayName) {
        await this.ssoLinkRepo.update(link.id, { displayName });
      }
      return link.user;
    }

    // ── 2. First-time SSO for an existing local account (matched by email) ──
    if (email) {
      const existing = await this.userRepo.findOne({ where: { email } });
      if (existing) {
        const newLink = this.ssoLinkRepo.create({
          userId: existing.id,
          provider: 'saml',
          providerUserId: nameId,
          providerEmail: email,
          displayName:
            (profile[CLAIM_NAME] as string | undefined) ??
            (profile.displayName as string | undefined) ??
            null,
        });
        await this.ssoLinkRepo.save(newLink);
        return existing;
      }
    }

    // ── 3. No match — IdP user has no StockMind account ─────────────────────
    throw new UnauthorizedException(
      'No StockMind account is linked to this SSO identity. ' +
        'Ask your administrator to link your account via Settings → Security.',
    );
  }
}
