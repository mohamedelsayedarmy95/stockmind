import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProductCreatedEvent } from '../../domain/events/product-created.event';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';

@Injectable()
export class ProductCreatedListener {
  private readonly logger = new Logger(ProductCreatedListener.name);

  constructor(private readonly audit: AuditLogService) {}

  @OnEvent(ProductCreatedEvent.NAME, { async: true })
  async handle(event: ProductCreatedEvent): Promise<void> {
    this.logger.log(`Product created: id=${event.productId} sku=${event.sku} corr=${event.correlationId}`);
    await this.audit.write({
      actorUserId: event.userId,
      companyId: event.companyId,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: event.productId,
      newValues: { sku: event.sku },
      correlationId: event.correlationId ?? null,
    });
  }
}
