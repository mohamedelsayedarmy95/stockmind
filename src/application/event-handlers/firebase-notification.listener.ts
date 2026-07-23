import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';

@Injectable()
export class FirebaseNotificationListener {
  private readonly logger = new Logger(FirebaseNotificationListener.name);

  constructor(private readonly firebase: FirebaseService) {}

  @OnEvent(StockReceivedEvent.NAME, { async: true })
  async handle(event: StockReceivedEvent): Promise<void> {
    // deviceToken is injected into the event by callers that have a token on hand
    // (e.g., from a user-device-tokens table looked up in the command handler).
    // If absent, the notification is skipped silently — never throws.
    const token = (event as unknown as Record<string, unknown>)['deviceToken'];
    if (typeof token !== 'string' || !token) return;

    await this.firebase.sendPushNotification(
      token,
      'Stock Received',
      `${event.quantity} units received. New balance: ${event.newBalance}`,
      {
        type: 'STOCK_RECEIVED',
        productId: event.productId,
        warehouseId: event.warehouseId,
        correlationId: event.correlationId ?? '',
      },
    );

    this.logger.debug(`Push dispatched for product ${event.productId}`);

    this.firebase.logAnalytics('stock_received', {
      productId: event.productId,
      warehouseId: event.warehouseId,
      quantity: event.quantity,
      companyId: event.companyId,
    });
  }
}
