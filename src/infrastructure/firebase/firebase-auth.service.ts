import { Injectable, Logger } from '@nestjs/common';
import { getAuth, isFirebaseConfigured } from './firebase-admin';

@Injectable()
export class FirebaseAuthService {
  private readonly logger = new Logger(FirebaseAuthService.name);

  async verifyIdToken(token: string): Promise<any> {
    if (!isFirebaseConfigured()) return null;

    try {
      return await getAuth().verifyIdToken(token);
    } catch (error) {
      this.logger.error('Failed to verify Firebase token', error);
      return null;
    }
  }

  async getUser(uid: string): Promise<any> {
    if (!isFirebaseConfigured()) return null;

    try {
      return await getAuth().getUser(uid);
    } catch (error) {
      this.logger.error('Failed to get Firebase user', error);
      return null;
    }
  }

  async createUser(email: string, password: string): Promise<any> {
    if (!isFirebaseConfigured()) return null;

    try {
      return await getAuth().createUser({ email, password });
    } catch (error) {
      this.logger.error('Failed to create Firebase user', error);
      return null;
    }
  }
}
