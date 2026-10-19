import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FirebaseService } from '../infrastructure/firebase/firebase.service';
import { FcmService } from '../infrastructure/firebase/fcm.service';
import { FirebaseAuthService } from '../infrastructure/firebase/firebase-auth.service';
import { FirebaseStorageService } from '../infrastructure/firebase/firebase-storage.service';
import { TokensRepository } from '../infrastructure/repositories/tokens.repository';
import { UserFcmToken } from '../domain/entities/user-fcm-token.entity';

@Global()
@Module({
  // FcmService persists and reads device tokens through TokensRepository.
  imports: [TypeOrmModule.forFeature([UserFcmToken])],
  providers: [
    FirebaseService,
    FcmService,
    FirebaseAuthService,
    FirebaseStorageService,
    TokensRepository,
  ],
  exports: [
    FirebaseService,
    FcmService,
    FirebaseAuthService,
    FirebaseStorageService,
    TokensRepository,
  ],
})
export class FirebaseModule {}
