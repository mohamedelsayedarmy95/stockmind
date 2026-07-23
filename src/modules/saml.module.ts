import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SamlStrategy } from '../infrastructure/auth/saml.strategy';
import { SamlController } from '../presentation/controllers/saml.controller';
import { User } from '../domain/entities/user.entity';
import { UserSsoLink } from '../domain/entities/user-sso-link.entity';

/**
 * SAML 2.0 SSO module.
 *
 * Registered in app.module.ts only when SAML_ENABLED=true.
 * All existing password+2FA flows are completely unaffected when this module
 * is absent (i.e., the default installation).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, UserSsoLink])],
  controllers: [SamlController],
  providers: [SamlStrategy],
})
export class SamlModule {}
