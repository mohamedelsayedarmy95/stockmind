import { Injectable, Logger } from '@nestjs/common';
import { getMessaging, isFirebaseConfigured } from './firebase-admin';
import * as admin from 'firebase-admin';
import { TokensRepository } from '../../infrastructure/repositories/tokens.repository';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private readonly tokensRepository: TokensRepository) {}

  async sendToDevice(userId: string, title: string, body: string, data?: any): Promise<void> {
    if (!isFirebaseConfigured()) {
      this.logger.warn('Firebase not configured, skipping notification');
      return;
    }

    try {
      const tokens = await this.tokensRepository.getUserTokens(userId);
      if (tokens.length === 0) {
        this.logger.log(`No FCM tokens found for user ${userId}`);
        return;
      }

      const fcmTokens = tokens.map(t => t.fcmToken);
      const message = {
        notification: { title, body },
        data: data || {},
        tokens: fcmTokens,
      };

      // Retry logic: 3 attempts with exponential backoff (100ms, 200ms, 400ms)
      let attempts = 0;
      let lastError: any;
      while (attempts < 3) {
        try {
          const response = await getMessaging().sendEachForMulticast(message);
          this.logger.log(`FCM multicast sent: ${response.successCount} successes, ${response.failureCount} failures`);

          // Handle token errors (e.g., unregistered or invalid tokens)
          if (response.failureCount > 0) {
            const failedTokens: string[] = [];
            for (const [idx, resp] of response.responses.entries()) {
              if (!resp.success) {
                const error = resp.error;
                // Common error codes for invalid/unregistered tokens
                if (error?.code === 'messaging/invalid-argument' ||
                    error?.code === 'messaging/registration-token-not-registered') {
                  failedTokens.push(fcmTokens[idx]);
                }
              }
            }
            // Remove invalid tokens from database
            for (const token of failedTokens) {
              await this.tokensRepository.removeToken(token);
              this.logger.warn(`Removed invalid FCM token: ${token.substring(0, 10)}...`);
            }
          }
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error;
          attempts++;
          if (attempts < 3) {
            const delay = 100 * Math.pow(2, attempts - 1); // 100, 200, 400 ms
            this.logger.warn(`FCM attempt ${attempts} failed, retrying in ${delay}ms:`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            this.logger.error('FCM failed after 3 attempts', error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to send FCM notification', error);
    }
  }

  async sendNotification(token: string, payload: any): Promise<void> {
    if (!isFirebaseConfigured()) {
      this.logger.warn('Firebase not configured, skipping notification');
      return;
    }
    try {
      await getMessaging().send({
        token,
        ...payload,
      });
    } catch (error) {
      this.logger.error('Failed to send FCM notification', error);
    }
  }

  async sendStockNotification(userId: string, action: string, productId: string, quantity: number): Promise<void> {
    const title = `Stock ${action}`;
    const body = `Product ${productId}: ${quantity} units ${action.toLowerCase()}`;
    await this.sendToDevice(userId, title, body, { action, productId, quantity: quantity.toString() });
  }
}