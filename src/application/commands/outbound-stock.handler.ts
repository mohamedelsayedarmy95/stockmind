import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboundStockCommand } from './outbound-stock.command';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { FcmService } from '../../infrastructure/firebase/fcm.service';
import { StockIssuedEvent } from '../../domain/events/stock-issued.event';

@CommandHandler(OutboundStockCommand)
export class OutboundStockHandler implements ICommandHandler<OutboundStockCommand> {
  constructor(
    private readonly stock: StockService,
    private readonly events: EventEmitter2,
    private readonly cqrsEventBus: EventBus,
    private readonly fcmService: FcmService,
  ) {}

  async execute(cmd: OutboundStockCommand) {
    const movement = await this.stock.outbound(cmd.userId, cmd.companyId, cmd.dto);

    // The listeners write the STOCK_ISSUED audit row; the event is part of the write, not optional.
    const event = new StockIssuedEvent(
      cmd.dto.productId,
      cmd.dto.warehouseId,
      cmd.companyId,
      cmd.userId,
      cmd.dto.quantity,
      movement.runningBalance,
      cmd.correlationId,
    );
    this.events.emit(StockIssuedEvent.NAME, event);
    this.cqrsEventBus.publish(event);

    // Fire-and-forget push; a failed notification never fails the movement.
    this.fcmService
      .sendStockNotification(cmd.userId, 'STOCK_SHIPPED', cmd.dto.productId, parseFloat(cmd.dto.quantity))
      .catch((error) => {
        console.error('Failed to send stock shipped notification:', error);
      });

    return movement;
  }
}
