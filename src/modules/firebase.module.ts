import { Global, Module } from '@nestjs/common';
import { FirebaseService } from '../infrastructure/firebase/firebase.service';

@Global()
@Module({
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
