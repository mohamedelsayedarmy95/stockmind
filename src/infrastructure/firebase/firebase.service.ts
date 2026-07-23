import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const rawKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !rawKey || !clientEmail) {
      this.logger.warn('Firebase credentials not configured — push notifications disabled');
      return;
    }

    // Docker/CI env vars store \n as literal two-char escape sequence
    const privateKey = rawKey.replace(/\\n/g, '\n');

    if (admin.apps.length === 0) {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
      });
    } else {
      this.app = admin.app();
    }

    this.logger.log('Firebase Admin initialized');
  }

  async sendPushNotification(
    deviceToken: string,
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<void> {
    if (!this.app) return;

    try {
      await admin.messaging(this.app).send({
        token: deviceToken,
        notification: { title, body },
        data,
        android: { priority: 'high' },
        apns: { payload: { aps: { badge: 1, sound: 'default' } } },
      });
      this.logger.debug(`Push sent to ${deviceToken.slice(0, 8)}…`);
    } catch (err) {
      // Never let a failed push crash the event handler
      this.logger.error(`Push notification failed for token ${deviceToken.slice(0, 8)}…`, err);
    }
  }

  /**
   * Verifies a Google ID token issued by Firebase Authentication (via the Android
   * Google Sign-In SDK). Returns the decoded token payload on success.
   * Throws if Firebase is not initialised or the token is invalid/expired.
   */
  async verifyGoogleIdToken(
    idToken: string,
  ): Promise<{ uid: string; email: string; name: string; picture?: string }> {
    if (!this.app) {
      throw new Error('Firebase not initialised — set FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL');
    }
    const decoded = await admin.auth(this.app).verifyIdToken(idToken, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      name: decoded.name ?? decoded.email ?? '',
      picture: decoded.picture,
    };
  }

  /**
   * Firebase Admin SDK does not expose a server-side Analytics logging API.
   * This method emits a structured Pino log line that can be forwarded to
   * BigQuery or a Cloud Function consumer via a log sink.
   */
  logAnalytics(eventName: string, params: Record<string, unknown>): void {
    this.logger.log({ event: eventName, params }, 'analytics.event');
  }
}
