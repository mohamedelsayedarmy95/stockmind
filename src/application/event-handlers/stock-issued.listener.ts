import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StockIssuedEvent } from '../../domain/events/stock-issued.event';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';

@Injectable()
export class StockIssuedListener {
  private readonly logger = new Logger(StockIssuedListener.name);

  constructor(private readonly audit: AuditLogService) {}

  @OnEvent(StockIssuedEvent.NAME, { async: true })
  async handle(event: StockIssuedEvent): Promise<void> {
    this.logger.log(
      `Stock issued: product=${event.productId} qty=${event.quantity} balance=${event.newBalance} corr=${event.correlationId}`,
    );
    await this.audit.write({
      actorUserId: event.userId,
      companyId: event.companyId,
      action: 'STOCK_ISSUED',
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
