import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StockReceivedEvent } from '../../domain/events/stock-received.event';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';

@Injectable()
export class StockReceivedListener {
  private readonly logger = new Logger(StockReceivedListener.name);

  constructor(private readonly audit: AuditLogService) {}

  @OnEvent(StockReceivedEvent.NAME, { async: true })
  async handle(event: StockReceivedEvent): Promise<void> {
    this.logger.log(
      `Stock received: product=${event.productId} qty=${event.quantity} balance=${event.newBalance} corr=${event.correlationId}`,
    );
    await this.audit.write({
      actorUserId: event.userId,
      companyId: event.companyId,
      action: 'STOCK_RECEIVED',
      entityType: 'stock_movement',
      entityId: event.productId,
      newValues: {
        productId: event.productId,
        warehouseId: event.warehouseId,
        quantity: event.quantity,
        newBalance: event.newBalance,
      },
      correlationId: event.correlationId ?? null,
    });
  }
}
