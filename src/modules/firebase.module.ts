import { Global, Module } from '@nestjs/common';
import { FirebaseService } from '../infrastructure/firebase/firebase.service';
import { FcmService } from '../infrastructure/firebase/fcm.service';
import { FirebaseAuthService } from '../infrastructure/firebase/firebase-auth.service';
import { FirebaseStorageService } from '../infrastructure/firebase/firebase-storage.service';

@Global()
@Module({
  providers: [
    FirebaseService,
    FcmService,
    FirebaseAuthService,
    FirebaseStorageService,
  ],
  exports: [
    FirebaseService,
    FcmService,
    FirebaseAuthService,
    FirebaseStorageService,
  ],
})
export class FirebaseModule {}