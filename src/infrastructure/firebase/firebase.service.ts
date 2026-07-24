import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { OAuth2Client } from 'google-auth-library';

/**
 * Public OAuth Web client id (safe to ship — it is not a secret). Overridable
 * via GOOGLE_WEB_CLIENT_ID. MUST match the `webClientId` the mobile Google
 * Sign-In SDK is configured with, because that value is the audience of the
 * Google ID token the app sends.
 */
const DEFAULT_GOOGLE_WEB_CLIENT_ID =
  '763924631139-nc9o8g9g2pjj9gbt3bin2o56itm8nf05.apps.googleusercontent.com';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;
  // Verifies Google ID tokens against Google's public keys. Independent of the
  // Firebase Admin app (which stays for push messaging) and needs no service
  // account for verification.
  private readonly googleClient = new OAuth2Client();

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
   * Verifies a **Google** ID token produced by the Android Google Sign-In SDK
   * (@react-native-google-signin). That SDK returns a Google-issued ID token
   * (issuer accounts.google.com, audience = the Web client id), NOT a Firebase
   * ID token — so it must be validated with google-auth-library, not
   * admin.auth().verifyIdToken() (which only accepts Firebase tokens and would
   * always reject this token). The audience check pins the token to our client.
   */
  async verifyGoogleIdToken(
    idToken: string,
  ): Promise<{ uid: string; email: string; name: string; picture?: string }> {
    const audience =
      this.config.get<string>('GOOGLE_WEB_CLIENT_ID') ?? DEFAULT_GOOGLE_WEB_CLIENT_ID;

    const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new Error('Google ID token has no email claim');
    }
    return {
      uid: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      picture: payload.picture,
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
