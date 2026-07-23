import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from '../infrastructure/repositories/auth.service';
import { AuthController } from '../presentation/controllers/auth.controller';
import { JwtStrategy } from '../infrastructure/jwt.strategy';
import { TwoFactorService } from '../infrastructure/security/two-factor.service';
import { BruteForceService } from '../infrastructure/security/brute-force.service';
import { FirebaseModule } from './firebase.module';
import { User } from '../domain/entities/user.entity';
import { Company } from '../domain/entities/company.entity';
import { Warehouse } from '../domain/entities/warehouse.entity';
import { UserTwoFactor } from '../domain/entities/user-two-factor.entity';
import { LoginAttempt } from '../domain/entities/login-attempt.entity';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    TypeOrmModule.forFeature([User, Company, Warehouse, UserTwoFactor, LoginAttempt]),
    FirebaseModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TwoFactorService, BruteForceService],
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
